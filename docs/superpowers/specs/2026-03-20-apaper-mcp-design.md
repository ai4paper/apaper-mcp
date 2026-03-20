# apaper-mcp Design

## Goal

Bootstrap a new MCP server project at the current repository root using Bun and TypeScript, treating this local git repository as the source that will be connected to and pushed into a new public GitHub repository at `ai4paper/apaper-mcp` using `gh`.

## Scope

This first iteration focuses on a clean, minimal foundation:

- initialize the local Bun + TypeScript project
- add a minimal MCP server entrypoint
- include one example capability so the server is functional
- document how to run, build, and publish it
- create and push to a new public GitHub repository

Out of scope for this pass:

- multiple tools/resources/prompts
- authentication or secrets management
- deployment beyond GitHub hosting
- advanced linting, formatting, or CI automation

## Recommended Approach

Use a minimal MCP starter structure with Bun + TypeScript and a stdio-first server entrypoint built on `@modelcontextprotocol/sdk`.

This approach gives the fastest path to a useful first commit while keeping the structure easy to extend. It avoids over-designing the project before the core MCP server wiring is confirmed working.

## Alternatives Considered

### 1. Minimal MCP starter (recommended)

Keep the scaffold small: Bun scripts, TypeScript config, one server bootstrap, one example capability, and a concise README.

Trade-offs:

- fastest to initialize and publish
- lowest maintenance overhead
- easiest to reshape once real MCP features are known
- fewer guardrails than a more fully tooled template

### 2. Structured starter with linting and formatting

Add ESLint, Prettier, a fuller source layout, and supporting config from day one.

Trade-offs:

- better long-term hygiene
- more files and setup overhead before first push
- higher chance of bikeshedding tool choices before core behavior exists

### 3. SDK-heavy abstraction-first starter

Model the project around a richer SDK example with more abstractions and extension points up front.

Trade-offs:

- useful when the server shape is already well understood
- more initial complexity
- slower path to a first working and publishable baseline

## Architecture

The project will use Bun as the runtime and package manager, TypeScript for authoring, and `@modelcontextprotocol/sdk` as the MCP implementation library. The source layout will stay intentionally small for the first commit.

The initial server will target stdio transport because it is the most common starting point for MCP integrations and avoids adding network configuration too early. The first version will expose one example tool named `ping` using a Zod input schema equivalent to `{ message?: string }`. The tool will return MCP text content with the string `pong` when no message is supplied, or `pong: <message>` when one is supplied. That gives a concrete minimum bar for "functional": the server starts, registers tool metadata, and can answer a trivial tool invocation without crashing.

## Proposed File Layout

- `package.json` — Bun scripts, dependency metadata, project name
- `bun.lock` — Bun lockfile
- `tsconfig.json` — TypeScript compiler settings
- `.gitignore` — ignore Bun, TypeScript, editor/build outputs, and `dist/`
- `src/index.ts` — MCP server bootstrap and example capability registration
- `README.md` — project overview, setup, run/build instructions, publish notes

Required scripts:

- `bun run dev` — run the TypeScript entrypoint in development
- `bun run build` — compile TypeScript to `dist/`
- `bun run start` — run the built server from `dist/index.js`

The compiled `dist/` output is a build artifact and should remain untracked.

## Data and Control Flow

1. Developer runs the Bun dev or start command.
2. Bun launches the TypeScript MCP server entrypoint.
3. The server registers its metadata and the `ping` tool.
4. An MCP client communicates with the server over stdio.
5. The `ping` tool returns text content containing `pong` or `pong: <message>` to confirm the server works end to end.

## Error Handling

The setup flow should fail early and clearly when required tooling is missing.

- if `bun` is unavailable, stop before scaffolding and report that Bun must be installed
- if `gh` is unavailable or not authenticated, stop before repository creation and report the exact issue
- if the local build fails, do not create the initial push until the scaffold is fixed
- if GitHub repository creation succeeds but push fails, keep the local repository state intact and report the recovery command(s)
- if the working tree contains unrelated uncommitted changes before the initial scaffold is ready, stop and report the state instead of mixing them into the first publish

## Verification

Before publishing, verify:

- dependencies install successfully with `bun install`
- the TypeScript project builds successfully with `bun run build`
- the development entrypoint passes a 3-second smoke test with `timeout 3s bun run dev`, logging a ready message on stderr and exiting only because of the timeout
- the built entrypoint passes a 3-second smoke test with `timeout 3s bun run start`, logging a ready message on stderr and exiting only because of the timeout
- git remote setup points at `ai4paper/apaper-mcp`

The ready message should be `apaper-mcp running on stdio`, written with `console.error(...)` so stdout remains reserved for MCP protocol traffic. For the first iteration, proof of readiness is: install succeeds, build succeeds into `dist/`, and both the development and built stdio server commands survive the smoke-test window without crashing. A more formal automated MCP interaction test can be added in a later pass once the server behavior expands.

## Git and Publishing Flow

1. Initialize the Bun + TypeScript project locally.
2. Add the MCP server scaffold and documentation.
3. Verify the local build succeeds.
4. Confirm the package name is `apaper-mcp` so local project metadata matches the repository name.
5. Create the new public GitHub repository with `gh` under `ai4paper/apaper-mcp`.
6. If the org creation call fails because the name already exists or the authenticated user lacks permission in `ai4paper`, stop and report the exact failure instead of guessing a fallback.
7. Add `origin` if it is missing; if `origin` already points somewhere else, stop and report that conflict before changing remotes.
8. Require a clean working tree before the initial commit and push, aside from the scaffold files created for this work.
9. If the current branch is not `main`, rename it to `main` before the first push rather than creating a second local branch.
10. Create the initial commit containing the runnable scaffold.
11. Push `main` to GitHub.

The repository should be created directly as public, not created private-first and then changed later. This order ensures the remote starts with usable code rather than an empty repository.

## Success Criteria

The work is successful when:

- this local repository contains a working Bun + TypeScript MCP server scaffold
- `README.md` explains how to install, run, and build the project
- the project builds locally without manual patching
- a new public GitHub repository exists at `ai4paper/apaper-mcp`
- `main` is pushed with the initial project contents
