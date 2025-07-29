# 🌿 Branching Strategy

Cherry Studio implements a structured branching strategy to maintain code quality and streamline the development process.

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

For details about the `testplan` branch used in the Test Plan, please refer to the [Test Plan](testplan-en.md).

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
   - Submit PR to both `main` and relevant `release` branches

5. **Release Branches:**
   - Create from `main` branch
   - Naming format: `release/version-number`
   - Used for final preparation work before version release
   - Only accepts bug fixes and documentation updates
   - After testing and preparation, merge back to `main` and tag with version

## Workflow Diagram

![](https://github.com/user-attachments/assets/61db64a2-fab1-4a16-8253-0c64c9df1a63)

## Pull Request Guidelines

- All PRs should be submitted to the `main` branch unless fixing a critical production issue
- Ensure your branch is up to date with the latest `main` changes before submitting
- Include relevant issue numbers in your PR description
- Make sure all tests pass and code meets our quality standards
- Add before/after screenshots if you add a new feature or modify a UI component

## Version Tag Management

- Major releases: v1.0.0, v2.0.0, etc.
- Feature releases: v1.1.0, v1.2.0, etc.
- Patch releases: v1.0.1, v1.0.2, etc.
- Hotfix releases: v1.0.1-hotfix, etc.
