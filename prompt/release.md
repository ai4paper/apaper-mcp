# Release Prompt

Use this prompt when preparing a local release for `@ai4paper/apaper-mcp`.

## Prompt

```md
Prepare a local release for `@ai4paper/apaper-mcp`.

Release target: `v<version>`
Release date: `<YYYY-MM-DD>`
GitHub username for changelog attribution: `@<username>`

Do the following in order:

1. Update `CHANGELOG.md`:
   - keep the `## [Unreleased]` section at the top
   - add or update the `## [<version>] - <YYYY-MM-DD>` section
   - ensure each bullet ends with `(@<username>)`
   - keep the entries concise and release-focused

2. Update `package.json`:
   - set `version` to `<version>`
   - keep package name as `@ai4paper/apaper-mcp`

3. Update `bun.lock` so it reflects the current package version and dependency state.

4. Verify the release locally:
   - run `bun run build`
   - run `npm pack --dry-run`

5. Commit the release changes with a release-style commit message.

6. Create a git tag named `v<version>`.

7. Report:
   - the version released
   - the commit hash
   - the tag name
   - any verification results

Do not push unless explicitly asked.
```
