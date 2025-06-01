#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { checkDomain, checkDomainsParallel } from './domain-checker.js'

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
          },
          required: ['domains'],
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
      const { domain } = args as { domain: string }

      if (!domain || typeof domain !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Domain parameter is required and must be a string',
        )
      }

      const result = await checkDomain(domain)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    }
    else if (name === 'check_domains_batch') {
      const { domains, concurrency = 4 } = args as {
        domains: string[]
        concurrency?: number
      }

      if (!Array.isArray(domains) || domains.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Domains parameter is required and must be a non-empty array',
        )
      }

      const results = await checkDomainsParallel(domains, concurrency)

      // Format results for better readability
      const summary = {
        total: results.length,
        available: results.filter(r => r.available).length,
        taken: results.filter(r => !r.available && !r.error).length,
        errors: results.filter(r => r.error).length,
        results,
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
