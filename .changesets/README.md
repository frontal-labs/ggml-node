# Changesets

Every change that a user of `local-llm` would notice gets a changeset.

```sh
bun run changeset        # pick patch, minor or major, and write a one-line summary
```

Commit the generated `.changesets/*.md` file with your change. On `main`, the release workflow
collects the pending changesets into a "Version Packages" pull request. Merging that pull request
bumps the version, updates `CHANGELOG.md`, and publishes to npm with provenance.

Use `patch` for fixes, `minor` for new options or features, and `major` for breaking changes to
the public API described in `docs/api.md`.
