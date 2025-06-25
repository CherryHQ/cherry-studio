# Verify Perfect Information (PI) Standards

This command runs the Perfect Information (PI) checker to ensure code quality and documentation standards are met.

## Usage

```bash
# Run PI checker
node scripts/pi-checker.js

# Run PI checker with verbose output
node scripts/pi-checker.js --verbose

# Run PI checker for specific files
node scripts/pi-checker.js --files "src/**/*.ts,src/**/*.tsx"

# Run PI checker with JSON output
node scripts/pi-checker.js --json > pi-report.json

# Run PI checker with auto-fix (where possible)
node scripts/pi-checker.js --fix
```

## What PI Standards Check

### 1. Code Documentation
- **Function Documentation**: All exported functions must have JSDoc comments
- **Complex Logic**: Complex functions (>20 lines) must have detailed comments
- **Type Definitions**: All TypeScript interfaces/types must be documented
- **Component Props**: React components must have documented props

### 2. Test Coverage
- **Unit Tests**: All modules must have corresponding test files
- **Test Descriptions**: Tests must have clear, descriptive names
- **Coverage Thresholds**: Maintain minimum 80% code coverage
- **E2E Tests**: Critical user paths must have E2E tests

### 3. Code Quality
- **No Console Logs**: Production code must not contain console.log statements
- **Error Handling**: All async operations must have proper error handling
- **Type Safety**: No `any` types without explicit justification
- **Import Organization**: Imports must be properly organized and grouped

### 4. File Organization
- **Naming Conventions**: Files must follow consistent naming patterns
- **Directory Structure**: Code must be organized according to architectural patterns
- **File Size**: Files should not exceed 500 lines (excluding tests)
- **Single Responsibility**: Each file should have a single, clear purpose

### 5. Commit Standards
- **Conventional Commits**: All commits must follow conventional commit format
- **Atomic Commits**: Each commit should represent a single logical change
- **Signed Commits**: All commits must be signed (--signoff)

### 6. Pull Request Standards
- **PR Description**: Must include clear description of changes
- **Issue Linking**: Must reference related issues
- **Test Evidence**: Must include evidence of testing
- **Breaking Changes**: Must be clearly documented

### 7. Security Standards
- **No Hardcoded Secrets**: No API keys, passwords, or tokens in code
- **Dependency Audit**: No high-severity vulnerabilities in dependencies
- **Input Validation**: All user inputs must be validated
- **Safe IPC**: All IPC channels must use preload scripts

### 8. Performance Standards
- **Bundle Size**: Monitor and document bundle size changes
- **Lazy Loading**: Use code splitting for large components
- **Memoization**: Use proper memoization for expensive operations
- **Render Optimization**: Avoid unnecessary re-renders

## Example Output

```
🔍 Perfect Information (PI) Check Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Code Documentation: PASSED
   - 142/142 functions documented
   - 38/38 complex functions have detailed comments
   - 56/56 types documented

⚠️  Test Coverage: WARNING
   - Coverage: 78.5% (threshold: 80%)
   - Missing tests: src/renderer/src/services/NewService.ts

❌ Code Quality: FAILED
   - Found 3 console.log statements
   - Found 2 'any' types without justification
   - Files affected:
     • src/renderer/src/utils/debug.ts:45
     • src/main/services/TempService.ts:23,67

✅ File Organization: PASSED
   - All files follow naming conventions
   - No files exceed size limit

✅ Security Standards: PASSED
   - No hardcoded secrets found
   - All IPC channels use preload scripts

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Overall Status: FAILED ❌
3 issues must be resolved before merge
```

## Integration with CI/CD

The PI checker is automatically run on:
- All pull requests
- Pushes to main/develop branches
- Feature branch updates

Failed PI checks will:
1. Block PR merging
2. Add a comment with detailed feedback
3. Generate an artifact with the full report

## Running Locally

Before pushing changes, always run:

```bash
# Full check suite
yarn typecheck && yarn lint && yarn test && node scripts/pi-checker.js

# Quick PI check only
node scripts/pi-checker.js --files "$(git diff --name-only --cached)"
```

## Exemptions

If you need to exempt a file or rule:

1. Add a comment with justification:
   ```typescript
   // PI-EXEMPT: console.log - Required for debugging in development
   console.log('Debug info:', data);
   ```

2. For file-level exemptions, add to `.pi-ignore`:
   ```
   # Generated files
   src/generated/**
   
   # Third-party code
   src/vendor/**
   ```

## Auto-fix Support

Some issues can be automatically fixed:

```bash
# Fix what can be auto-fixed
node scripts/pi-checker.js --fix

# Show what would be fixed without applying
node scripts/pi-checker.js --fix --dry-run
```

Auto-fixable issues:
- Missing JSDoc templates
- Import organization
- Some formatting issues
- File header comments

## Claude Integration

You can also use this command directly with Claude:

```bash
# In Claude, ask:
"Run the PI checker on the current codebase"
"Check if my recent changes meet PI standards"
"Fix PI violations in src/services/"
```

Claude will:
1. Execute the PI checker
2. Analyze the results
3. Suggest fixes for any violations
4. Help implement the fixes if requested

## Pre-commit Hook

Add to your git hooks for automatic checking:

```bash
# .git/hooks/pre-commit
#!/bin/sh
node scripts/pi-checker.js --files "$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$' | tr '\n' ',')"
```

## Questions?

For questions about PI standards or exemptions, please:
1. Check `.github/pi-standards.md` for detailed explanations
2. Ask in the PR comments
3. Contact the maintainers

Remember: Perfect Information standards ensure our codebase remains maintainable, secure, and accessible to all contributors!