# Perfect Information (PI) Standards

This document defines the Perfect Information standards for the neucleos Cockpit project. These standards ensure code quality, maintainability, security, and collaboration efficiency.

## Table of Contents

1. [Overview](#overview)
2. [Code Documentation Standards](#code-documentation-standards)
3. [Test Coverage Standards](#test-coverage-standards)
4. [Code Quality Standards](#code-quality-standards)
5. [File Organization Standards](#file-organization-standards)
6. [Commit Standards](#commit-standards)
7. [Pull Request Standards](#pull-request-standards)
8. [Security Standards](#security-standards)
9. [Performance Standards](#performance-standards)
10. [Exemptions and Overrides](#exemptions-and-overrides)

## Overview

Perfect Information (PI) standards are enforced automatically through GitHub Actions on all pull requests and commits to protected branches. The goal is to maintain a high-quality, secure, and well-documented codebase that any developer can understand and contribute to effectively.

### Core Principles

1. **Clarity**: Code should be self-documenting with additional documentation where needed
2. **Testability**: All code should be tested and testable
3. **Security**: Security should be built-in, not bolted on
4. **Performance**: Performance implications should be considered and documented
5. **Maintainability**: Code should be easy to understand, modify, and extend

## Code Documentation Standards

### Function Documentation

All exported functions must have JSDoc comments:

```typescript
/**
 * Calculates the hash of a given string using SHA-256
 * @param input - The string to hash
 * @param encoding - The output encoding (default: 'hex')
 * @returns The hashed string in the specified encoding
 * @throws {Error} If the input is not a valid string
 * @example
 * ```typescript
 * const hash = calculateHash('hello world');
 * console.log(hash); // '2ef7bde608...'
 * ```
 */
export function calculateHash(input: string, encoding: 'hex' | 'base64' = 'hex'): string {
  // Implementation
}
```

### Complex Function Documentation

Functions exceeding 20 lines must include:
- Detailed description of the algorithm/logic
- Step-by-step comments for complex sections
- Performance considerations
- Edge cases handled

```typescript
/**
 * Processes a batch of messages with retry logic and error handling
 * 
 * This function implements an exponential backoff retry strategy for processing
 * messages. It maintains a queue of failed messages and retries them with
 * increasing delays.
 * 
 * Algorithm:
 * 1. Sort messages by priority
 * 2. Process in batches of 100
 * 3. Retry failed messages up to 3 times
 * 4. Log permanently failed messages
 * 
 * Performance: O(n log n) due to sorting, processes ~1000 messages/second
 * Memory: Maintains a retry queue up to 10,000 messages
 */
export async function processBatchMessages(messages: Message[]): Promise<ProcessResult> {
  // Step 1: Validate and sort messages
  // ... detailed implementation with inline comments
}
```

### Type Documentation

All exported interfaces and types must be documented:

```typescript
/**
 * Configuration options for the MCP server connection
 */
export interface MCPServerConfig {
  /** The server hostname or IP address */
  host: string;
  
  /** The server port (default: 3000) */
  port?: number;
  
  /** Authentication token for secure connections */
  authToken?: string;
  
  /** Timeout in milliseconds for server responses */
  timeout?: number;
  
  /** Whether to automatically reconnect on disconnection */
  autoReconnect?: boolean;
}
```

### Component Documentation

React components must document their props:

```typescript
interface ChatMessageProps {
  /** The message content to display */
  message: string;
  
  /** The user who sent the message */
  sender: User;
  
  /** Timestamp of when the message was sent */
  timestamp: Date;
  
  /** Whether this message is from the current user */
  isOwnMessage?: boolean;
  
  /** Callback fired when the message is clicked */
  onClick?: (message: string) => void;
}

/**
 * Displays a single chat message with sender info and timestamp
 * 
 * @example
 * ```tsx
 * <ChatMessage
 *   message="Hello world"
 *   sender={currentUser}
 *   timestamp={new Date()}
 *   isOwnMessage
 * />
 * ```
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({ ... }) => {
  // Implementation
};
```

## Test Coverage Standards

### Coverage Requirements

- **Minimum Coverage**: 80% line coverage
- **Critical Paths**: 100% coverage for:
  - Authentication/authorization logic
  - Payment processing
  - Data encryption/decryption
  - API endpoints
  - Error handling

### Test Structure

Every module should have a corresponding test file:

```
src/
  services/
    UserService.ts
    UserService.test.ts
  components/
    Button.tsx
    Button.test.tsx
```

### Test Quality

Tests must be:
- **Descriptive**: Clear test names that describe what is being tested
- **Isolated**: No dependencies between tests
- **Comprehensive**: Cover happy paths, edge cases, and error scenarios

```typescript
describe('UserService', () => {
  describe('createUser', () => {
    it('should create a user with valid data', async () => {
      // Test implementation
    });
    
    it('should throw an error for duplicate email', async () => {
      // Test implementation
    });
    
    it('should validate email format', async () => {
      // Test implementation
    });
    
    it('should handle database connection errors gracefully', async () => {
      // Test implementation
    });
  });
});
```

## Code Quality Standards

### No Console Logs

Production code must not contain `console.log` statements:

```typescript
// ❌ Bad
function processData(data: any) {
  console.log('Processing data:', data);
  return transform(data);
}

// ✅ Good
import { logger } from '@/utils/logger';

function processData(data: any) {
  logger.debug('Processing data:', { dataId: data.id });
  return transform(data);
}
```

### Type Safety

Avoid `any` types without justification:

```typescript
// ❌ Bad
function processData(data: any) {
  return data.value;
}

// ✅ Good
function processData(data: ProcessableData) {
  return data.value;
}

// ✅ Acceptable with justification
function processData(data: any) { // any: Third-party library returns untyped data
  return data.value;
}
```

### Error Handling

All async operations must have proper error handling:

```typescript
// ❌ Bad
async function fetchUser(id: string) {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}

// ✅ Good
async function fetchUser(id: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${id}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch user: ${response.statusText}`);
    }
    
    return response.json();
  } catch (error) {
    logger.error('Error fetching user:', { userId: id, error });
    throw new UserFetchError(`Could not fetch user ${id}`, error);
  }
}
```

### Import Organization

Imports should be organized and grouped:

```typescript
// External dependencies
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from 'antd';

// Internal dependencies
import { useAuth } from '@/hooks/useAuth';
import { UserService } from '@/services/UserService';
import { formatDate } from '@/utils/date';

// Types
import type { User } from '@/types/user';
import type { ApiResponse } from '@/types/api';

// Styles
import styles from './UserProfile.module.css';
```

## File Organization Standards

### Naming Conventions

- **React Components**: PascalCase (e.g., `UserProfile.tsx`)
- **Utilities/Services**: camelCase (e.g., `userService.ts`)
- **Constants**: UPPER_SNAKE_CASE in files (e.g., `API_ENDPOINTS`)
- **Test Files**: Same name with `.test.ts` or `.spec.ts`
- **Styles**: Same name with `.module.css` or `.scss`

### Directory Structure

```
src/
  components/          # Reusable UI components
    Button/
      Button.tsx
      Button.test.tsx
      Button.module.css
      index.ts
  pages/              # Page components
  services/           # Business logic and API calls
  hooks/              # Custom React hooks
  utils/              # Utility functions
  types/              # TypeScript type definitions
  assets/             # Images, fonts, etc.
  styles/             # Global styles
```

### File Size Limits

- **Maximum file size**: 500 lines (excluding tests)
- **Index files**: Maximum 50 lines (should only export)
- **Component files**: Prefer smaller, focused components

### Single Responsibility

Each file should have a single, clear purpose:

```typescript
// ❌ Bad: UserService.ts
export class UserService {
  // User CRUD operations
  // Email sending logic
  // Password hashing
  // Session management
}

// ✅ Good: Separate concerns
// UserService.ts - User CRUD operations
// EmailService.ts - Email sending
// AuthService.ts - Authentication logic
// SessionService.ts - Session management
```

## Commit Standards

### Conventional Commits

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test additions or corrections
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Other changes that don't modify src or test files
- `revert`: Reverts a previous commit

Examples:
```bash
feat(auth): add OAuth2 integration with Google

Implemented Google OAuth2 flow with proper error handling
and token refresh mechanism.

Closes #123

# Signed commit
git commit -m "fix(api): handle null response in user endpoint" --signoff
```

### Commit Guidelines

1. **Atomic Commits**: Each commit should represent one logical change
2. **Present Tense**: Use present tense ("add feature" not "added feature")
3. **Imperative Mood**: Use imperative mood ("move cursor to..." not "moves cursor to...")
4. **Line Length**: Subject line max 72 characters, body wrapped at 80 characters
5. **Reference Issues**: Link to related issues in the footer

## Pull Request Standards

### PR Template

PRs must include:

```markdown
## Description
Brief description of what this PR does

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing
- [ ] Unit tests pass locally
- [ ] Integration tests pass locally
- [ ] Manual testing completed
- [ ] E2E tests updated/added if needed

## Checklist
- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] New and existing unit tests pass locally
- [ ] Any dependent changes have been merged and published

## Screenshots (if applicable)
[Add screenshots here]

## Related Issues
Closes #(issue number)
```

### PR Size

- **Preferred**: < 400 lines of code changes
- **Maximum**: < 1000 lines of code changes
- **Large PRs**: Should be split into smaller, logical chunks

## Security Standards

### No Hardcoded Secrets

Never commit sensitive data:

```typescript
// ❌ Bad
const API_KEY = 'sk-1234567890abcdef';
const DATABASE_URL = 'postgresql://user:password@localhost/db';

// ✅ Good
const API_KEY = process.env.API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
```

### Input Validation

Always validate user input:

```typescript
// ❌ Bad
function searchUsers(query: string) {
  return db.query(`SELECT * FROM users WHERE name LIKE '%${query}%'`);
}

// ✅ Good
function searchUsers(query: string) {
  if (!query || query.length > 100) {
    throw new ValidationError('Invalid search query');
  }
  
  const sanitizedQuery = query.replace(/[%_]/g, '\\$&');
  return db.query('SELECT * FROM users WHERE name LIKE ?', [`%${sanitizedQuery}%`]);
}
```

### Safe IPC Communication

Use preload scripts for IPC:

```typescript
// ❌ Bad: Direct IPC in renderer
import { ipcRenderer } from 'electron';
ipcRenderer.send('delete-file', filePath);

// ✅ Good: Via preload API
window.api.deleteFile(filePath);
```

### Dependency Security

- Run `yarn audit` regularly
- No high-severity vulnerabilities allowed
- Medium-severity vulnerabilities must be justified
- Keep dependencies up to date

## Performance Standards

### Bundle Size Monitoring

- Document bundle size impact for new dependencies
- Use dynamic imports for large components
- Implement code splitting for routes

```typescript
// ✅ Good: Lazy load large components
const HeavyComponent = lazy(() => import('./HeavyComponent'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <HeavyComponent />
    </Suspense>
  );
}
```

### Render Optimization

Prevent unnecessary re-renders:

```typescript
// ✅ Good: Memoize expensive computations
const expensiveValue = useMemo(
  () => computeExpensiveValue(a, b),
  [a, b]
);

// ✅ Good: Memoize components
const MemoizedComponent = memo(({ data }) => {
  return <div>{data}</div>;
});
```

### Performance Monitoring

- Document performance implications
- Add performance marks for critical operations
- Monitor and log slow operations

```typescript
/**
 * Processes large dataset
 * Performance: O(n log n), ~1000 items/second
 * Memory: Peaks at ~50MB for 10k items
 */
async function processLargeDataset(items: Item[]) {
  performance.mark('processDataset-start');
  
  try {
    // Processing logic
    return results;
  } finally {
    performance.mark('processDataset-end');
    performance.measure('processDataset', 'processDataset-start', 'processDataset-end');
  }
}
```

## Exemptions and Overrides

### Temporary Exemptions

Use PI-EXEMPT comments with justification:

```typescript
// PI-EXEMPT: console.log - Required for debugging Electron main process
console.log('Main process started');

// PI-EXEMPT: any - Third-party library has no types
function processExternalData(data: any) {
  return externalLib.process(data);
}
```

### Permanent Exemptions

Add to `.pi-ignore` file:

```
# Generated files
src/generated/**
*.generated.ts

# Third-party code
src/vendor/**

# Legacy code (remove by 2024-12-31)
src/legacy/**

# Test fixtures
**/__fixtures__/**
```

### Override Process

1. Add exemption with clear justification
2. Create issue to track removal of exemption
3. Set deadline for addressing the exemption
4. Get approval from maintainers for permanent exemptions

## Enforcement

### Automated Checks

- PI checks run on every PR automatically
- Failing checks block PR merging
- Detailed feedback provided in PR comments

### Local Development

Run checks locally before pushing:

```bash
# Quick check
node scripts/pi-checker.js

# Full check suite
yarn typecheck && yarn lint && yarn test && node scripts/pi-checker.js

# Check specific files
node scripts/pi-checker.js --files "src/services/*.ts"

# Auto-fix what's possible
node scripts/pi-checker.js --fix
```

### Gradual Adoption

For existing codebases:
1. Run `node scripts/pi-checker.js --json > baseline.json`
2. Set enforcement to only check changed files
3. Gradually fix existing issues
4. Enable full enforcement once clean

## Questions and Support

- Check this documentation first
- Ask in PR comments for specific exemptions
- Contact maintainers for clarification
- Propose changes via GitHub issues

Remember: These standards exist to help us maintain a high-quality, secure, and maintainable codebase. They're not meant to slow down development but to ensure sustainable growth of the project.