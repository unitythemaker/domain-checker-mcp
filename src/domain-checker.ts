import { domain as rdapDomain } from 'node-rdap'
import pLimit from 'p-limit'
import { lookup as whoisLookup } from 'whoisit'

export type DomainStatus = 'available' | 'taken' | 'unknown' | 'rate_limited'

export interface DomainInfo {
  registrar?: string
  expirationDate?: string
  daysUntilExpiration?: number
  creationDate?: string
  lastUpdated?: string
}

export interface DomainCheckResult {
  domain: string
  available: boolean
  status: DomainStatus
  method: 'rdap' | 'whois'
  error?: string
  registrationData?: any
  domainInfo?: DomainInfo
}

// Retry configuration
const MAX_RETRIES = 3
const INITIAL_DELAY = 1000 // 1 second
const BACKOFF_MULTIPLIER = 2

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    }
    catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Check if it's a rate limit error
      const errorMessage = lastError.message.toLowerCase()
      if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
        if (attempt < maxRetries - 1) {
          const delay = INITIAL_DELAY * BACKOFF_MULTIPLIER ** attempt
          await sleep(delay)
          continue
        }
      }

      // If not rate limited or last attempt, throw immediately
      throw error
    }
  }

  throw lastError
}

function extractDomainInfo(data: any, method: 'rdap' | 'whois'): DomainInfo {
  const info: DomainInfo = {}

  if (method === 'rdap' && data) {
    // Extract from RDAP response
    if (data.entities) {
      const registrar = data.entities.find((e: any) =>
        e.roles?.includes('registrar') || e.vcardArray?.[1]?.some((v: any) => v[0] === 'fn'),
      )
      if (registrar?.vcardArray?.[1]) {
        const fnEntry = registrar.vcardArray[1].find((v: any) => v[0] === 'fn')
        if (fnEntry) {
          info.registrar = fnEntry[3]
        }
      }
    }

    // Extract dates from events
    if (data.events) {
      const expirationEvent = data.events.find((e: any) => e.eventAction === 'expiration')
      const registrationEvent = data.events.find((e: any) => e.eventAction === 'registration')
      const lastChangedEvent = data.events.find((e: any) => e.eventAction === 'last changed')

      if (expirationEvent?.eventDate) {
        info.expirationDate = expirationEvent.eventDate
        const expirationTime = new Date(expirationEvent.eventDate).getTime()
        const nowTime = Date.now()
        info.daysUntilExpiration = Math.floor((expirationTime - nowTime) / (1000 * 60 * 60 * 24))
      }

      if (registrationEvent?.eventDate) {
        info.creationDate = registrationEvent.eventDate
      }

      if (lastChangedEvent?.eventDate) {
        info.lastUpdated = lastChangedEvent.eventDate
      }
    }
  }
  else if (method === 'whois' && data) {
    // Extract from WHOIS response
    const whoisText = typeof data === 'string' ? data : JSON.stringify(data)

    // Common WHOIS patterns - using [^\r\n]+ to avoid backtracking issues
    const registrarMatch = whoisText.match(/Registrar:\s*([^\r\n]+)/i)
    const expirationMatch = whoisText.match(/(?:Expir(?:y|ation) Date|Expires on):\s*([^\r\n]+)/i)
    const creationMatch = whoisText.match(/(?:Creation Date|Created on):\s*([^\r\n]+)/i)
    const updatedMatch = whoisText.match(/(?:Updated Date|Last Updated):\s*([^\r\n]+)/i)

    if (registrarMatch) {
      info.registrar = registrarMatch[1].trim()
    }

    if (expirationMatch) {
      try {
        const expirationDate = new Date(expirationMatch[1].trim())
        info.expirationDate = expirationDate.toISOString()
        const nowTime = Date.now()
        info.daysUntilExpiration = Math.floor((expirationDate.getTime() - nowTime) / (1000 * 60 * 60 * 24))
      }
      catch {
        // Invalid date format
      }
    }

    if (creationMatch) {
      try {
        info.creationDate = new Date(creationMatch[1].trim()).toISOString()
      }
      catch {
        // Invalid date format
      }
    }

    if (updatedMatch) {
      try {
        info.lastUpdated = new Date(updatedMatch[1].trim()).toISOString()
      }
      catch {
        // Invalid date format
      }
    }
  }

  return info
}

async function checkDomainWithRdap(domain: string): Promise<DomainCheckResult> {
  try {
    const result = await retryWithBackoff(() => rdapDomain(domain))

    // Check if registrationData is null or empty
    if (!result || Object.keys(result).length === 0) {
      return {
        domain,
        available: true,
        status: 'available',
        method: 'rdap',
        registrationData: null,
      }
    }

    // Check if the response contains a 404 error code (domain not found)
    if (result.errorCode === 404
      || (result.title && (result.title.toLowerCase().includes('not found') || result.title.toLowerCase().includes('object not found')))) {
      return {
        domain,
        available: true,
        status: 'available',
        method: 'rdap',
        registrationData: result, // Keep the error response for debugging
      }
    }

    // Check for other error codes that might indicate availability
    if (result.errorCode && result.errorCode >= 400) {
      // If it's a client error (4xx), likely means domain is available
      if (result.errorCode < 500) {
        return {
          domain,
          available: true,
          status: 'available',
          method: 'rdap',
          registrationData: result,
        }
      }
      // Server error (5xx) - status unknown
      return {
        domain,
        available: false,
        status: 'unknown',
        method: 'rdap',
        error: result.title || 'RDAP server error',
        registrationData: result,
      }
    }

    // Domain is registered
    const domainInfo = extractDomainInfo(result, 'rdap')

    return {
      domain,
      available: false,
      status: 'taken',
      method: 'rdap',
      registrationData: result,
      domainInfo,
    }
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : ''

    // Check for rate limiting
    if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
      return {
        domain,
        available: false,
        status: 'rate_limited',
        method: 'rdap',
        error: 'Rate limited by RDAP server',
      }
    }

    // Check if it's a "not found" error which means domain is available
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      return {
        domain,
        available: true,
        status: 'available',
        method: 'rdap',
        registrationData: null,
      }
    }

    // Re-throw to trigger fallback
    throw error
  }
}

async function checkDomainWithWhois(domain: string): Promise<DomainCheckResult> {
  try {
    const result = await retryWithBackoff(() => whoisLookup(domain))

    // Check if result is null or empty
    if (!result) {
      return {
        domain,
        available: true,
        status: 'available',
        method: 'whois',
        registrationData: null,
      }
    }

    // Parse whois response to determine availability
    const whoisText = typeof result === 'string' ? result : JSON.stringify(result)
    const lowerWhois = whoisText.toLowerCase()

    // Check for rate limiting indicators
    if (lowerWhois.includes('rate limit')
      || lowerWhois.includes('too many requests')
      || lowerWhois.includes('quota exceeded')) {
      return {
        domain,
        available: false,
        status: 'rate_limited',
        method: 'whois',
        error: 'Rate limited by WHOIS server',
        registrationData: result,
      }
    }

    // Common patterns indicating domain is available
    const availablePatterns = [
      'no match',
      'not found',
      'no data found',
      'status: available',
      'domain not found',
      'no entries found',
      'domain status: available',
      'not registered',
      'is available',
      'object does not exist',
      'domain name not known',
      'no such domain',
      'domain is not registered',
    ]

    const isAvailable = availablePatterns.some(pattern => lowerWhois.includes(pattern))

    // Special check for responses that start with "Domain not found" before the terms
    const startsWithNotFound = whoisText.trim().toLowerCase().startsWith('domain not found')

    // Also check if response is very short (likely a "not found" template)
    const isSuspiciouslyShort = whoisText.trim().length < 100 && !lowerWhois.includes('registrar')

    if (isAvailable || isSuspiciouslyShort || startsWithNotFound) {
      return {
        domain,
        available: true,
        status: 'available',
        method: 'whois',
        registrationData: null,
      }
    }

    // Domain is taken - extract additional info
    const domainInfo = extractDomainInfo(result, 'whois')

    return {
      domain,
      available: false,
      status: 'taken',
      method: 'whois',
      registrationData: result,
      domainInfo,
    }
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const lowerErrorMessage = errorMessage.toLowerCase()

    // Check for rate limiting in error
    if (lowerErrorMessage.includes('rate limit') || lowerErrorMessage.includes('too many requests')) {
      return {
        domain,
        available: false,
        status: 'rate_limited',
        method: 'whois',
        error: 'Rate limited by WHOIS server',
      }
    }

    // If error is empty string or just whitespace, it's suspicious
    if (!errorMessage.trim()) {
      return {
        domain,
        available: false,
        status: 'unknown',
        method: 'whois',
        error: 'Empty error response from WHOIS',
      }
    }

    return {
      domain,
      available: false,
      status: 'unknown',
      method: 'whois',
      error: errorMessage,
    }
  }
}

export async function checkDomain(domain: string): Promise<DomainCheckResult> {
  // Normalize domain
  domain = domain.toLowerCase().trim()

  try {
    // Try RDAP first
    return await checkDomainWithRdap(domain)
  }
  catch {
    // Fallback to whois
    try {
      return await checkDomainWithWhois(domain)
    }
    catch {
      return {
        domain,
        available: false,
        status: 'unknown',
        method: 'whois',
        error: 'Both RDAP and WHOIS checks failed',
      }
    }
  }
}

export async function checkDomainsParallel(
  domains: string[],
  concurrency: number = 4,
): Promise<DomainCheckResult[]> {
  const limit = pLimit(concurrency)

  const promises = domains.map(domain =>
    limit(() => checkDomain(domain)),
  )

  return Promise.all(promises)
}
