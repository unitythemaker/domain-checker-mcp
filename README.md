# Domain Checker MCP

An MCP (Model Context Protocol) server that checks domain availability using RDAP (Registration Data Access Protocol) with WHOIS fallback.

## Features

- Check single domain availability
- Batch check multiple domains in parallel
- Prioritizes RDAP for domain lookups
- Falls back to WHOIS when RDAP is unavailable
- Configurable parallel workers (default: 4)

## Installation

```bash
pnpm install
pnpm build
```

## Usage

### Running the MCP server

```bash
pnpm start
```

### Available Tools

1. **check_domain** - Check if a single domain is available
   - Input: `domain` (string) - The domain name to check

2. **check_domains_batch** - Check multiple domains in parallel
   - Input:
     - `domains` (string[]) - Array of domain names to check
     - `concurrency` (number, optional) - Number of parallel workers (1-10, default: 4)

### Response Format

Single domain check returns:
```json
{
  "domain": "example.com",
  "available": false,
  "method": "rdap",
  "registrationData": { ... }
}
```

Batch check returns:
```json
{
  "total": 5,
  "available": 2,
  "taken": 3,
  "errors": 0,
  "results": [...]
}
```

## MCP Configuration

Add this server to your MCP client configuration:

```json
{
  "mcpServers": {
    "domain-checker": {
      "command": "node",
      "args": ["/path/to/domain-checker-mcp/dist/index.js"]
    }
  }
}
```
