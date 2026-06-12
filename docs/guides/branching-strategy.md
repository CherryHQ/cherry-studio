# 🌿 Branching Strategy

Cherry Studio implements a structured branching strategy to maintain code quality and streamline the development process.

> **Current model.** `main` is the default branch for active development — submit features, refactors, optimizations, and fixes for the current codebase here. The `v1` branch is the maintenance line for the shipped v1 release: its hotfixes and subsequent v1 releases go there via `hotfix/*`, targeting `v1` (not `main`). A v1 fix does not auto-carry to `main`; if the same bug exists on `main`, open a separate forward-port PR targeting `main`. (v1 and v2 code currently coexist on `main` — expect large, breaking changes.) The generic flow below predates this phase; where it conflicts, this note wins.

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

   - Create from the `v1` branch
   - Naming format: `hotfix/issue-number-brief-description`
   - Submit PR to `v1`, not `main`. A v1 fix does not auto-carry to `main` — if the same bug exists on `main`, open a separate forward-port PR targeting `main`

5. **Release Branches:**
   - Create from `main` branch
   - Naming format: `release/version-number`
   - Used for final preparation work before version release
   - Only accepts bug fixes and documentation updates
   - After testing and preparation, merge back to `main` and tag with version

## Workflow Diagram

![](https://github.com/user-attachments/assets/61db64a2-fab1-4a16-8253-0c64c9df1a63)

## Pull Request Guidelines

- Active development (features, refactors, optimizations, fixes for the current codebase) goes to `main`; v1 hotfixes and subsequent v1 releases go to the `v1` branch (see the note at the top). A v1 fix is not auto-carried to `main` — forward-port it with a separate PR if the bug also exists on `main`
- Ensure your branch is up to date with the latest `main` changes before submitting
- Include relevant issue numbers in your PR description
- Make sure all tests pass and code meets our quality standards
- Add before/after screenshots if you add a new feature or modify a UI component

## Version Tag Management

- Major releases: v1.0.0, v2.0.0, etc.
- Feature releases: v1.1.0, v1.2.0, etc.
- Patch releases: v1.0.1, v1.0.2, etc.
- Hotfix releases: v1.0.1-hotfix, etc.
