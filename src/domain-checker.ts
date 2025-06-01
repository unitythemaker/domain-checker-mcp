import { domain as rdapDomain } from 'node-rdap'
import pLimit from 'p-limit'
import { lookup as whoisLookup } from 'whoisit'

export interface DomainCheckResult {
  domain: string
  available: boolean
  method: 'rdap' | 'whois'
  error?: string
  registrationData?: any
}

async function checkDomainWithRdap(domain: string): Promise<DomainCheckResult> {
  try {
    const result = await rdapDomain(domain)

    // If we get a result, the domain is registered
    return {
      domain,
      available: false,
      method: 'rdap',
      registrationData: result,
    }
  }
  catch (error) {
    // RDAP throws errors for unregistered domains or when not available
    if (error instanceof Error) {
      // Check if it's a "not found" error which means domain is available
      if (error.message.includes('404') || error.message.includes('not found')) {
        return {
          domain,
          available: true,
          method: 'rdap',
        }
      }
    }
    // Re-throw to trigger fallback
    throw error
  }
}

async function checkDomainWithWhois(domain: string): Promise<DomainCheckResult> {
  try {
    const result = await whoisLookup(domain)

    // Parse whois response to determine availability
    const whoisText = typeof result === 'string' ? result : JSON.stringify(result)
    const lowerWhois = whoisText.toLowerCase()

    // Common patterns indicating domain is available
    const availablePatterns = [
      'no match',
      'not found',
      'no data found',
      'status: available',
      'domain not found',
      'no entries found',
    ]

    const isAvailable = availablePatterns.some(pattern => lowerWhois.includes(pattern))

    return {
      domain,
      available: isAvailable,
      method: 'whois',
      registrationData: result,
    }
  }
  catch (error) {
    return {
      domain,
      available: false,
      method: 'whois',
      error: error instanceof Error ? error.message : 'Unknown whois error',
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
  catch (rdapError) {
    // Fallback to whois
    try {
      return await checkDomainWithWhois(domain)
    }
    catch (whoisError) {
      return {
        domain,
        available: false,
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
