# Release Prompt

Use this prompt when preparing and publishing a release for `apaper-mcp`.

## Prompt

```md
Prepare and publish a release for `apaper-mcp`.

Release target: `v<version>`
Release date: `<YYYY-MM-DD>`
GitHub username for changelog attribution: `@<username>`

Do the following in order:

1. Update `CHANGELOG.md`:
   - keep the `## [Unreleased]` section at the top
   - add or update the `## [<version>] - <YYYY-MM-DD>` section
   - ensure each bullet ends with `(@<username>)`
   - keep the entries concise and release-focused

2. Update `pyproject.toml`:
   - set `[project].version` to `<version>`

3. Update `uv.lock` so it reflects the current project version and dependency state:
   - run `uv lock`

4. Verify the release locally:
   - run `uv run pytest`
   - run `uv build`

5. Commit the release changes with a release-style commit message.

6. Create a git tag named `v<version>`.

7. Push the release commit and tag to `origin`:
   - push the current branch and `v<version>` atomically

8. Report:
   - the version released
   - the commit hash
   - the tag name
   - the pushed branch and remote
   - any verification results
```
