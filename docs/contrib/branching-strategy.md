---
description: Branch model for contributions, pull request guidelines, and version tag management targeting main
---

# 🌿 Branching Strategy

Cherry Studio implements a structured branching strategy to maintain code quality and streamline the development process.

> **Current model.** `main` is the default branch for all active development — submit features, refactors, optimizations, and fixes here.

## Main Branches

- `main`: Main development branch

  - Contains the latest development code
  - Direct commits are not allowed - changes must come through pull requests
  - Code may contain features in development and might not be fully stable

- `release/*`: Release branches
  - Created from the exact current `main` head by the **Pre Release** workflow; do not create them by hand in the normal flow
  - Contains stable code ready for release
  - Only accepts reviewed hotfix backports and release metadata updates; documentation changes continue through `main`
  - Thoroughly tested before production deployment

For details about the `testplan` branch used in the Test Plan, please refer to the [Test Plan](./test-plan.md).

## Contributing Branches

When contributing to Cherry Studio, please follow these guidelines:

1. **Feature Branches:**

   - Create from `main` branch
   - Naming format: `feature/issue-number-brief-description`
   - Submit PR back to `main`

2. **Bug Fix Branches:**

   - Create from `main` branch
   - Naming format: `fix/issue-number-brief-description`
   - Submit PR back to `main`

3. **Documentation Branches:**

   - Create from `main` branch
   - Naming format: `docs/brief-description`
   - Submit PR back to `main`

4. **Hotfix Branches:**

   - Create from `main` branch
   - Naming format: `hotfix/issue-number-brief-description`
   - Use a `hotfix: <description>` or `hotfix(<kebab-case-scope>): <description>` PR title
   - CI synchronizes the required `hotfix` label from the exact title grammar; for a user-facing fix, put exactly one release-note line in English and Chinese inside the PR template's `release-note` fence, otherwise use `NONE`
   - Submit PR back to `main`

5. **Release Branches:**
   - Created only by **Pre Release** from the exact validated `main` head
   - Naming format: `release/v<semantic-version>`
   - Used for final preparation work before version release
   - Only accepts reviewed hotfix backports and release metadata updates; documentation changes continue through `main`
   - Build and tag releases from this branch, never from `main`
   - Open PRs that satisfy the exact hotfix title are automatically labeled `hotfix`; after merge, they get a backport PR only when exactly one draft semantic-version release has a matching active release branch, and any provided bilingual note is validated and applied
   - Merge the backport PR only after its PR CI passes, wait for push CI on the resulting release-branch head, then rebuild the draft release
   - Resolve any automatically reported backport failure without merging all of `main` into the release branch
   - Publishing the GitHub Release applies the release metadata delta to the latest `main` and opens a metadata-only sync PR
   - Squash the metadata PR with the exact title `chore(release): sync v<version> metadata` (plus only GitHub's optional PR-number suffix) and keep `release-metadata-boundary: v<version>` on its own line in the squash commit body
   - Follow the [Release Workflow Operations](./release-workflow.md) runbook to prepare, build, hotfix, publish, and synchronize a release

## Workflow Diagram

![](https://github.com/user-attachments/assets/61db64a2-fab1-4a16-8253-0c64c9df1a63)

## Pull Request Guidelines

- Active development (features, refactors, optimizations, and fixes) goes to `main`
- Ensure your branch is up to date with the latest `main` changes before submitting
- Include relevant issue numbers in your PR description
- Make sure all tests pass and code meets our quality standards
- Add before/after screenshots if you add a new feature or modify a UI component

## Version Tag Management

- Major releases: v1.0.0, v2.0.0, etc.
- Feature releases: v1.1.0, v1.2.0, etc.
- Patch releases: v1.0.1, v1.0.2, etc.
- Fixes merged while a draft is active keep that draft's existing version tag. After publication, ship another fix under the next greater semantic version, normally the next patch (for example, `v1.0.2` after `v1.0.1`); do not create a separate `v1.0.1-hotfix` tag.
