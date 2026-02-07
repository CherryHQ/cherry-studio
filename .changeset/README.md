# Changesets

This folder contains configuration and changeset files for managing package versioning and publishing in the Cherry Studio monorepo.

## What is Changesets?

Changesets is a tool to help manage versioning and publishing for multi-package repositories. It tracks changes to packages and automates:

- Version bumping based on semantic versioning
- Changelog generation
- Package publishing
- Dependency updates between packages

## Quick Start

### Adding a changeset

When you make changes that should be published, run:

```bash
pnpm changeset add
```

This will:
1. Ask which packages have changed
2. Ask for the type of change (patch/minor/major)
3. Ask for a description of the change
4. Create a changeset file in `.changeset/`

### Versioning packages

When ready to release:

```bash
pnpm changeset version
```

This will:
1. Bump package versions based on accumulated changesets
2. Update CHANGELOG.md files
3. Update internal dependencies
4. Delete consumed changeset files

### Publishing packages

```bash
pnpm release:packages
```

This will:
1. Build all packages
2. Publish to npm
3. Create GitHub releases

## Configuration

See `config.json` for the changeset configuration:

- **changelog**: Uses `@changesets/changelog-github` to generate GitHub-linked changelogs
- **access**: `public` - packages are published publicly
- **baseBranch**: `main` - PRs target this branch
- **updateInternalDependencies**: `patch` - internal deps are updated on any change
- **ignore**: Packages not for publishing (shared, mcp-trace, ui)

## Packages managed

| Package | Current Version | Description |
|---------|----------------|-------------|
| `@cherrystudio/ai-core` | 1.0.9 | Unified AI Provider Interface |
| `@cherrystudio/ai-sdk-provider` | 0.1.3 | AI SDK provider bundle with CherryIN routing |
| `@cherrystudio/extension-table-plus` | 3.0.11 | Table extension for Tiptap |

## Dependency relationships

```
ai-core (peer-depends on) → ai-sdk-provider
```

Changeset automatically handles updating peer dependency ranges when `ai-sdk-provider` is published.

## CI/CD Integration

The `.github/workflows/release-packages.yml` workflow automatically:

1. Creates a "Version Packages" PR when changesets are merged to main
2. Publishes packages when the Version Packages PR is merged
3. Creates GitHub releases with changelogs

## Learn more

- [Changesets documentation](https://github.com/changesets/changesets)
- [Common questions](https://github.com/changesets/changesets/blob/main/docs/common-questions.md)
