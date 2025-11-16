# Contributing to AutomatSEO

Thank you for your interest in contributing to AutomatSEO! This document provides guidelines and information for contributors.

## Important Notice

AutomatSEO is a **closed-source** project. While we appreciate community interest, contributions are handled differently than open-source projects.

## How to Contribute

### Reporting Issues

1. **Security Issues**: Please do NOT report security vulnerabilities publicly. Email us at security@automatseo.com
2. **Bugs & Feature Requests**: Use the GitHub Issues section with appropriate templates
3. **Questions**: Check existing discussions before creating new ones

### Development Contributions

Due to the closed-source nature of this project:

1. **Direct Code Contributions**: Limited to core team members and approved contributors
2. **Pull Requests**: Only accepted from contributors with signed Contributor License Agreement (CLA)
3. **Code Access**: Source code access requires explicit permission from the project maintainers

### Getting Started

If you're an approved contributor:

1. **Fork the repository** to your GitHub account
2. **Create a feature branch** from `develop`: `git checkout -b feature/your-feature-name`
3. **Make your changes** following our coding standards
4. **Test thoroughly** on multiple platforms
5. **Submit a pull request** with detailed description

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/automatseo.git
cd automatseo

# Install dependencies
yarn install

# Run development mode
yarn dev

# Run tests
yarn test

# Build for production
yarn build:check
```

## Coding Standards

### Code Style

- Follow the existing codebase patterns and conventions
- Use TypeScript for type safety
- Write clear, self-documenting code
- Include JSDoc comments for complex functions

### Commit Messages

Use conventional commits format:

```
type(scope): description

feat(core): add new automation feature
fix(ui): resolve button click bug
docs(readme): update installation instructions
```

### Testing

- Write unit tests for new features
- Ensure all tests pass before submitting PR
- Test on Windows, macOS, and Linux when possible

## Branch Strategy

- `main`: Stable production releases
- `develop`: Integration branch for new features
- `feature/*`: Feature-specific branches
- `hotfix/*`: Critical bug fixes

## Review Process

1. **Automated Checks**: All CI/CD checks must pass
2. **Code Review**: At least one maintainer approval required
3. **Security Review**: For sensitive changes
4. **Testing**: Verified by the review team

## Security

- Follow secure coding practices
- Report vulnerabilities privately
- Never commit sensitive information
- Use environment variables for secrets

## Licensing

All contributions become the property of AutomatSEO and are subject to the same proprietary license terms.

## Community Guidelines

- Be respectful and professional
- Provide constructive feedback
- Help others when possible
- Follow GitHub's Community Guidelines

## Contact

- **General Inquiries**: github@automatseo.com
- **Security Issues**: security@automatseo.com
- **Licensing**: license@automatseo.com

## Recognition

Contributors who provide significant value will be:
- Listed in our contributors section
- Considered for maintainer roles
- Eligible for special recognition programs

Thank you for your interest in AutomatSEO!
