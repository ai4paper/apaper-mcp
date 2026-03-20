# apaper-mcp

Minimal MCP server starter built with Bun and TypeScript.

## Requirements

- Bun
- GitHub CLI (`gh`) for publishing

## Install

```bash
bun install
```

## Development

```bash
bun run dev
```

The server logs `apaper-mcp running on stdio` to stderr when it starts.

## Test

```bash
bun test
```

## Typecheck

```bash
bun run typecheck
```

## Build

```bash
bun run build
```

## Run built server

```bash
bun run start
```

## Example tool

- `ping`
  - input: `{ "message"?: string }`
  - output: `pong` or `pong: <message>`

## Publish to GitHub

```bash
gh repo create ai4paper/apaper-mcp --public --source=. --remote=origin --push
```
