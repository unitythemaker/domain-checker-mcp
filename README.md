# Domain Checker MCP

An MCP (Model Context Protocol) server that checks domain availability using RDAP (Registration Data Access Protocol) with WHOIS fallback.

## Features

- Check single domain availability
- Batch check multiple domains in parallel
- Prioritizes RDAP for domain lookups
- Falls back to WHOIS when RDAP is unavailable
- Configurable parallel workers (default: 4)

## MCP Configuration

### Using npm package

Add this server to your MCP client configuration:

```json
{
  "mcpServers": {
    "domain-checker": {
      "command": "npx",
      "args": ["-y", "domain-checker-mcp"]
    }
  }
}
```

### Using local installation

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

## Installation

### From npm

```bash
npm install -g domain-checker-mcp
```

### From source

```bash
git clone https://github.com/yourusername/domain-checker-mcp.git
cd domain-checker-mcp
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

3. **check_name_extensions** - Check a single name with multiple extensions
   - Input:
     - `name` (string) - The domain name without extension (e.g., "example")
     - `extensions` (string[]) - Array of extensions to check (e.g., ["com", "net", "org"])
     - `concurrency` (number, optional) - Number of parallel workers (1-10, default: 4)

4. **check_names_extensions** - Check multiple names with multiple extensions
   - Input:
     - `names` (string[]) - Array of domain names without extensions
     - `extensions` (string[]) - Array of extensions to check for each name
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

Name with extensions check returns:
```json
{
  "name": "example",
  "total": 3,
  "available": 1,
  "taken": 2,
  "errors": 0,
  "results": [...]
}
```

Multiple names with extensions returns:
```json
{
  "totalNames": 2,
  "totalExtensions": 3,
  "totalChecks": 6,
  "availableTotal": 2,
  "takenTotal": 4,
  "errorsTotal": 0,
  "resultsByName": {
    "example": {
      "total": 3,
      "available": 1,
      "taken": 2,
      "errors": 0,
      "domains": [...]
    },
    ...
  }
}
```

## Publishing

To publish a new version:

1. Update the version in `package.json`
2. Commit your changes
3. Create and push a new tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. GitHub Actions will automatically publish to npm

### Requirements

- Set `NPM_TOKEN` secret in your GitHub repository settings
- Tag must start with 'v' (e.g., v0.1.0, v1.0.0)

## License

MIT
