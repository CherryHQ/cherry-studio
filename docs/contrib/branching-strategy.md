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
  - Created from `main` branch
  - Contains stable code ready for release
  - Only accepts documentation updates and bug fixes
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
   - Use a `hotfix:` or `hotfix(scope):` PR title; CI synchronizes the required `hotfix` label from the title
   - Submit PR back to `main`

5. **Release Branches:**
   - Create from `main` branch
   - Naming format: `release/v<semantic-version>`
   - Used for final preparation work before version release
   - Only accepts bug fixes and documentation updates
   - Build and tag releases from this branch, never from `main`
   - Merged `hotfix:` PRs are automatically labeled and backported while one matching draft release is active
   - Resolve any automatically reported backport conflicts without merging all of `main` into the release branch
   - Publishing the GitHub Release opens a metadata-only sync PR from the release tag to the latest `main`
   - Keep the metadata PR title unchanged; its squash commit marks the next release-note collection boundary

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
- Hotfix releases: v1.0.1-hotfix, etc.
