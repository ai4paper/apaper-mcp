# apaper-mcp Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a minimal Bun + TypeScript MCP server with a single `ping` tool to `ai4paper/apaper-mcp`.

**Architecture:** The project stays at the repository root and uses Bun for package management and runtime, TypeScript for source authoring, and the published `@modelcontextprotocol/sdk` package with stdio transport for the server. The first code commit keeps all runtime logic in `src/index.ts`, compiles to `dist/`, and proves readiness with install, typecheck, and startup smoke checks; the README commit follows in Chunk 2 before any publish or push step.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk`, Zod, Git, GitHub CLI

---

## File Structure

- Create: `.gitignore` — ignore `node_modules/`, `dist/`, Bun cache artifacts, and editor junk
- Create: `package.json` — project metadata, scripts, and runtime/dev dependencies
- Create: `tsconfig.json` — TypeScript compiler config targeting `dist/`
- Create: `src/index.ts` — MCP server bootstrap, `ping` tool registration, stdio connection, ready logging, fatal error handling
- Create: `README.md` — install, dev, build, start, and publish instructions
- Create: `docs/superpowers/plans/2026-03-20-apaper-mcp.md` — this plan
- Create indirectly: `bun.lock` — Bun lockfile after dependency install

## Chunk 1: Local Bun + TypeScript MCP scaffold

### Task 1: Create the project metadata and compiler configuration

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Verify Bun is available before scaffolding**

Run: `bun --version`

Expected: Bun prints a version and exits successfully

- [ ] **Step 2: Verify the working tree is clean before creating scaffold files**

Run: `git status --short`

Expected: no output

If any uncommitted changes appear, stop here and do not mix them into the scaffold work.

- [ ] **Step 3: Write the ignore rules**

Create `.gitignore` with at least these lines:

```gitignore
node_modules/
dist/
.DS_Store
*.log
.idea/
.vscode/
*.tsbuildinfo
```

- [ ] **Step 4: Write the package metadata**

Create `package.json` with this shape:

```json
{
  "name": "apaper-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target node",
    "start": "bun dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.27.1",
    "zod": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/node": "latest"
  }
}
```

- [ ] **Step 5: Write the TypeScript config**

Create `tsconfig.json` with this shape:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 6: Install dependencies and generate the lockfile**

Run: `bun install`

Expected:
- `bun.lock` is created
- dependencies install without error

- [ ] **Step 7: Do not stage or commit the metadata-only scaffold yet**

Do not create a commit yet. The first implementation commit in this plan should include the runnable MCP scaffold from Task 2.

### Task 2: Implement the minimal MCP stdio server

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create the source directory**

Run: `mkdir -p src`

Expected: the `src/` directory exists for the new entrypoint

- [ ] **Step 2: Write the server implementation**

Create `src/index.ts` with this exact structure:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "apaper-mcp",
  version: "0.1.0",
});

server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Return a pong response for smoke testing the MCP server.",
    inputSchema: z.object({
      message: z.string().optional(),
    }),
  },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: message ? `pong: ${message}` : "pong",
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("apaper-mcp running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
```

The implementation must preserve the spec contract for `ping`: return `pong` when no message is supplied, and `pong: <message>` when `message` is supplied.

- [ ] **Step 3: Verify the development entrypoint smoke test**

Run:

```bash
sh -c 'timeout 3s bun run dev >/tmp/apaper-dev.out 2>/tmp/apaper-dev.err; test $? -eq 124 && grep -q "apaper-mcp running on stdio" /tmp/apaper-dev.err'
```

Expected:
- command exits successfully
- stderr capture contains `apaper-mcp running on stdio`
- the wrapped Bun process was terminated by `timeout` with exit code `124`

- [ ] **Step 4: Verify TypeScript checks cleanly**

Run: `bunx tsc --noEmit`

Expected:
- PASS
- TypeScript accepts `src/index.ts` with no type errors

- [ ] **Step 5: Verify the build output**

Run: `bun run build`

Expected:
- PASS
- `dist/index.js` exists

- [ ] **Step 6: Verify the built entrypoint smoke test**

Run:

```bash
sh -c 'timeout 3s bun run start >/tmp/apaper-start.out 2>/tmp/apaper-start.err; test $? -eq 124 && grep -q "apaper-mcp running on stdio" /tmp/apaper-start.err'
```

Expected:
- command exits successfully
- stderr capture contains `apaper-mcp running on stdio`
- the wrapped Bun process was terminated by `timeout` with exit code `124`

- [ ] **Step 7: Leave the code changes uncommitted until the README exists**

Do not commit yet. The first publish-ready commit in this plan is created in Chunk 2 after `README.md` is added.

## Chunk 2: Documentation and GitHub publishing

### Task 3: Document local development and publishing

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

Create `README.md` with these sections:

```md
# apaper-mcp

Minimal MCP server starter built with Bun and TypeScript.

## Requirements

- Bun
- Node.js
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
```

- [ ] **Step 2: Verify the README matches the implementation**

Run:

```bash
grep -n "apaper-mcp running on stdio\|gh repo create ai4paper/apaper-mcp" README.md
```

Expected: `README.md` contains the exact ready log text `apaper-mcp running on stdio` and the exact publish command `gh repo create ai4paper/apaper-mcp --public --source=. --remote=origin --push`

- [ ] **Step 3: Commit the docs**

Before committing, run: `git status --short`

Expected: only `.gitignore`, `README.md`, `package.json`, `tsconfig.json`, `bun.lock`, and `src/index.ts` appear

Run:

```bash
git add README.md src/index.ts package.json tsconfig.json bun.lock .gitignore
git commit -m "feat: add initial bun mcp server scaffold"
```

### Task 4: Create and push the GitHub repository

**Files:**
- Modify: local git metadata only

- [ ] **Step 1: Verify the working tree is clean before publishing**

Run: `git status --short`

Expected: no output

- [ ] **Step 2: Verify tooling and GitHub authentication**

Run:

```bash
bun --version
gh auth status
```

Expected:
- Bun prints a version
- GitHub CLI reports authenticated access

- [ ] **Step 3: Re-run local verification before GitHub publishing**

Run:

```bash
bun install
bun run build
sh -c 'timeout 3s bun run dev >/tmp/apaper-dev.out 2>/tmp/apaper-dev.err; test $? -eq 124 && grep -q "apaper-mcp running on stdio" /tmp/apaper-dev.err'
sh -c 'timeout 3s bun run start >/tmp/apaper-start.out 2>/tmp/apaper-start.err; test $? -eq 124 && grep -q "apaper-mcp running on stdio" /tmp/apaper-start.err'
```

Expected: all commands pass

- [ ] **Step 4: Verify the remote conflict state before creating `origin`**

Run:

```bash
git remote get-url origin
```

Expected:
- if `origin` is missing, the command fails and publishing can continue with repository creation
- if `origin` exists and already points to `git@github.com:ai4paper/apaper-mcp.git` or `https://github.com/ai4paper/apaper-mcp.git`, publishing can continue without replacing it
- if `origin` points anywhere else, stop and report the conflict instead of overwriting it

- [ ] **Step 5: Verify the branch name**

Run: `git branch --show-current`

Expected: `main`

If not `main`, run: `git branch -M main`

- [ ] **Step 6: Create the public repository and push when `origin` is missing**

If `origin` is missing, run:

```bash
gh repo create ai4paper/apaper-mcp --public --source=. --remote=origin --push
```

Expected:
- repository is created in the `ai4paper` org
- `origin` points to the new GitHub repo
- local `main` is pushed successfully
- if the command fails because the repo already exists or org permissions are missing, stop and report that exact error

- [ ] **Step 7: Push when `origin` already points to the target repo**

If `origin` already points to `ai4paper/apaper-mcp`, run:

```bash
git push -u origin main
```

Expected:
- local `main` is pushed successfully without changing the remote definition

- [ ] **Step 8: Verify the remote**

Run:

```bash
git remote -v
gh repo view ai4paper/apaper-mcp --json nameWithOwner,url,visibility
```

Expected:
- `origin` points to `ai4paper/apaper-mcp`
- repo visibility is `PUBLIC`

- [ ] **Step 9: Record completion status**

Run: `git status --short --branch`

Expected:
- branch is `main`
- working tree is clean
- branch tracks `origin/main` after push
