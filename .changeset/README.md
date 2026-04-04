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

> **Note**: CI will check that PRs modifying packages include a changeset.

### Versioning and publishing

Versioning and publishing are handled automatically by CI — you do **not** need to run `changeset version` or `changeset publish` locally. See the [CI/CD Integration](#cicd-integration) section below.

## Configuration

See `config.json` for the changeset configuration:

- **changelog**: Uses `@changesets/changelog-github` to generate GitHub-linked changelogs
- **access**: `public` - packages are published publicly
- **baseBranch**: `main` - PRs target this branch
- **updateInternalDependencies**: `patch` - internal deps are updated on any change

## Packages managed

| Package | Description |
| --- | --- |
| `@cherrystudio/ai-core` | Unified AI Provider Interface |
| `@cherrystudio/ai-sdk-provider` | AI SDK provider bundle with CherryIN routing |
| `@cherrystudio/extension-table-plus` | Table extension for Tiptap |

### Dependency relationships

```
ai-core (peer-depends on) → ai-sdk-provider
```

Changeset automatically handles updating peer dependency ranges when `ai-sdk-provider` is published.

## CI/CD Integration

The release workflow (`.github/workflows/release-packages.yml`) uses [changesets/action](https://github.com/changesets/changesets/blob/main/packages/action/README.md) and works in two phases:

### Phase 1 — Accumulate changes

When a PR containing changeset files is merged to `main`, the action detects pending changesets and **creates or updates** a "Version Packages" PR. This PR:

- Bumps package versions based on all accumulated changesets
- Generates/updates `CHANGELOG.md` for each package
- Deletes consumed changeset files

Multiple PRs with changesets can merge before a release — the Version Packages PR keeps updating to include all of them.

### Phase 2 — Publish

When a maintainer decides it's time to release, they **merge the Version Packages PR**. This triggers the workflow again, and since there are no more pending changesets, the action runs `pnpm changeset:publish` to publish the updated packages to npm.

**In short**: changesets accumulate automatically; you control when to release by merging the Version Packages PR.

## Learn more

- [Changesets documentation](https://github.com/changesets/changesets)
- [Common questions](https://github.com/changesets/changesets/blob/main/docs/common-questions.md)
