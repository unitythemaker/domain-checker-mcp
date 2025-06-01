#!/usr/bin/env node
import type { DomainCheckResult } from './domain-checker.js'
import process from 'node:process'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { checkDomain, checkDomainsParallel } from './domain-checker.js'

// Helper function to filter registrationData based on includeRawResponse option
function filterRegistrationData(result: DomainCheckResult, includeRawResponse: boolean): DomainCheckResult {
  // Always include raw response if:
  // 1. includeRawResponse is true
  // 2. Status is unknown or rate_limited (suspicious cases)
  // 3. There's an error (but not empty string errors)
  // 4. Available domain with errorCode OTHER than certain 404 (suspicious availability)
  const shouldIncludeRaw = includeRawResponse
    || result.status === 'unknown'
    || result.status === 'rate_limited'
    || (result.error !== undefined && result.error !== '')
    || (result.available && result.registrationData?.errorCode && result.registrationData.errorCode !== 404)

  if (!shouldIncludeRaw) {
    // Remove registrationData for efficiency
    const { registrationData, ...filteredResult } = result
    return filteredResult
  }

  return result
}

const server = new Server(
  {
    name: 'domain-checker-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

// Tool to check a single domain
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'check_domain',
        description: 'Check if a domain is available for registration',
        inputSchema: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              description: 'The domain name to check (e.g., example.com)',
            },
            includeRawResponse: {
              type: 'boolean',
              description: 'Include raw RDAP/WHOIS response data (default: false)',
              default: false,
            },
          },
          required: ['domain'],
        },
      },
      {
        name: 'check_domains_batch',
        description: 'Check availability of multiple domains in parallel',
        inputSchema: {
          type: 'object',
          properties: {
            domains: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'Array of domain names to check',
            },
            concurrency: {
              type: 'number',
              description: 'Number of parallel workers (default: 4)',
              minimum: 1,
              maximum: 10,
              default: 4,
            },
            includeRawResponse: {
              type: 'boolean',
              description: 'Include raw RDAP/WHOIS response data (default: false)',
              default: false,
            },
          },
          required: ['domains'],
        },
      },
      {
        name: 'check_name_extensions',
        description: 'Check availability of a single name with multiple extensions',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The domain name without extension (e.g., "example")',
            },
            extensions: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'Array of extensions to check (e.g., ["com", "net", "org"])',
            },
            concurrency: {
              type: 'number',
              description: 'Number of parallel workers (default: 4)',
              minimum: 1,
              maximum: 10,
              default: 4,
            },
            includeRawResponse: {
              type: 'boolean',
              description: 'Include raw RDAP/WHOIS response data (default: false)',
              default: false,
            },
          },
          required: ['name', 'extensions'],
        },
      },
      {
        name: 'check_names_extensions',
        description: 'Check availability of multiple names with multiple extensions',
        inputSchema: {
          type: 'object',
          properties: {
            names: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'Array of domain names without extensions',
            },
            extensions: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'Array of extensions to check for each name',
            },
            concurrency: {
              type: 'number',
              description: 'Number of parallel workers (default: 4)',
              minimum: 1,
              maximum: 10,
              default: 4,
            },
            includeRawResponse: {
              type: 'boolean',
              description: 'Include raw RDAP/WHOIS response data (default: false)',
              default: false,
            },
          },
          required: ['names', 'extensions'],
        },
      },
    ],
  }
})

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    if (name === 'check_domain') {
      const { domain, includeRawResponse = false } = args as { domain: string, includeRawResponse?: boolean }

      if (!domain || typeof domain !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Domain parameter is required and must be a string',
        )
      }

      const result = await checkDomain(domain)
      const filteredResult = filterRegistrationData(result, includeRawResponse)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(filteredResult, null, 2),
          },
        ],
      }
    }
    else if (name === 'check_domains_batch') {
      const { domains, concurrency = 4, includeRawResponse = false } = args as {
        domains: string[]
        concurrency?: number
        includeRawResponse?: boolean
      }

      if (!Array.isArray(domains) || domains.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Domains parameter is required and must be a non-empty array',
        )
      }

      const results = await checkDomainsParallel(domains, concurrency)
      const filteredResults = results.map(r => filterRegistrationData(r, includeRawResponse))

      // Format results for better readability
      const summary = {
        total: filteredResults.length,
        available: filteredResults.filter(r => r.available).length,
        taken: filteredResults.filter(r => r.status === 'taken').length,
        errors: filteredResults.filter(r => r.error).length,
        rateLimited: filteredResults.filter(r => r.status === 'rate_limited').length,
        unknown: filteredResults.filter(r => r.status === 'unknown').length,
        results: filteredResults,
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      }
    }
    else if (name === 'check_name_extensions') {
      const { name: domainName, extensions, concurrency = 4, includeRawResponse = false } = args as {
        name: string
        extensions: string[]
        concurrency?: number
        includeRawResponse?: boolean
      }

      if (!domainName || typeof domainName !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Name parameter is required and must be a string',
        )
      }

      if (!Array.isArray(extensions) || extensions.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Extensions parameter is required and must be a non-empty array',
        )
      }

      // Generate full domain names
      const domains = extensions.map(ext => `${domainName}.${ext}`)
      const results = await checkDomainsParallel(domains, concurrency)
      const filteredResults = results.map(r => filterRegistrationData(r, includeRawResponse))

      // Format results grouped by name
      const summary = {
        name: domainName,
        total: filteredResults.length,
        available: filteredResults.filter(r => r.available).length,
        taken: filteredResults.filter(r => r.status === 'taken').length,
        errors: filteredResults.filter(r => r.error).length,
        rateLimited: filteredResults.filter(r => r.status === 'rate_limited').length,
        unknown: filteredResults.filter(r => r.status === 'unknown').length,
        results: filteredResults,
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      }
    }
    else if (name === 'check_names_extensions') {
      const { names, extensions, concurrency = 4, includeRawResponse = false } = args as {
        names: string[]
        extensions: string[]
        concurrency?: number
        includeRawResponse?: boolean
      }

      if (!Array.isArray(names) || names.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Names parameter is required and must be a non-empty array',
        )
      }

      if (!Array.isArray(extensions) || extensions.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Extensions parameter is required and must be a non-empty array',
        )
      }

      // Generate all combinations of names and extensions
      const domains: string[] = []
      for (const name of names) {
        for (const ext of extensions) {
          domains.push(`${name}.${ext}`)
        }
      }

      const results = await checkDomainsParallel(domains, concurrency)
      const filteredResults = results.map(r => filterRegistrationData(r, includeRawResponse))

      // Group results by name
      const groupedResults: Record<string, any> = {}
      for (const name of names) {
        const nameResults = filteredResults.filter(r => r.domain.startsWith(`${name}.`))
        groupedResults[name] = {
          total: nameResults.length,
          available: nameResults.filter(r => r.available).length,
          taken: nameResults.filter(r => r.status === 'taken').length,
          errors: nameResults.filter(r => r.error).length,
          rateLimited: nameResults.filter(r => r.status === 'rate_limited').length,
          unknown: nameResults.filter(r => r.status === 'unknown').length,
          domains: nameResults,
        }
      }

      const summary = {
        totalNames: names.length,
        totalExtensions: extensions.length,
        totalChecks: filteredResults.length,
        availableTotal: filteredResults.filter(r => r.available).length,
        takenTotal: filteredResults.filter(r => r.status === 'taken').length,
        errorsTotal: filteredResults.filter(r => r.error).length,
        rateLimitedTotal: filteredResults.filter(r => r.status === 'rate_limited').length,
        unknownTotal: filteredResults.filter(r => r.status === 'unknown').length,
        resultsByName: groupedResults,
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      }
    }
    else {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${name}`,
      )
    }
  }
  catch (error) {
    if (error instanceof McpError) {
      throw error
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Error executing tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
})

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Domain Checker MCP server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
