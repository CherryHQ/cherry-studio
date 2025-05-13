# 🌿 Branching Strategy

Cherry Studio follows a structured branching strategy to maintain code quality and streamline the development process:

## Main Branches

- `main`: Production-ready branch containing stable releases

  - All code here is thoroughly tested and ready for production
  - Direct commits are not allowed - changes must come through pull requests
  - Each merge to main represents a new release

- `develop` (default): Primary development branch
  - Contains the latest delivered development changes for the next release
  - Relatively stable but may contain features in progress
  - This is the default branch for development

## Contributing Branches

When contributing to Cherry Studio, please follow these guidelines:

1. **For bug fixes:**

   - Create a branch from `develop`
   - Name format: `fix/issue-number-brief-description`
   - Submit pull request back to `develop`

2. **For new features:**

   - Create a branch from `develop`
   - Name format: `feature/issue-number-brief-description`
   - Submit pull request back to `develop`

3. **For documentation:**

   - Create a branch from `develop`
   - Name format: `docs/brief-description`
   - Submit pull request back to `develop`

4. **For critical hotfixes:**
   - Create a branch from `main`
   - Name format: `hotfix/issue-number-brief-description`
   - Submit pull request to both `main` and `develop`

## Pull Request Guidelines

- Always create pull requests against the `develop` branch unless fixing a critical production issue
- Ensure your branch is up to date with the latest `develop` changes before submitting
- Include relevant issue numbers in your PR description
- Make sure all tests pass and code meets our quality standards
- Critical hotfixes may be submitted against `main` but must also be merged into `develop`
