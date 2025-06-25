# Git Branch Management Process for Neucleos Cockpit

---

created: 2025-01-27T19:45:00Z
updated: 2025-01-27T19:45:00Z
updatedBy: v0-AI-Assistant
version: 1.0.0

---

## Overview

This document outlines the complete git branch management process for the Neucleos Cockpit project, including all the gotchas, pre-commit hooks, and proper procedures learned through actual implementation.

## Pre-Branch Creation Checklist

### 1. Understand Current State

```bash
# Always start by understanding where you are
git branch --show-current
git status
git log --oneline -5
```

**Key Questions to Answer:**

- What branch am I currently on?
- Are there uncommitted changes?
- What recent work has been done?
- Are there staged changes that need to be committed?

### 2. Handle Uncommitted Changes

**If you have uncommitted changes, you MUST handle them first:**

```bash
# Option A: Commit them to current branch
git add .
git commit -m "your message with PI verification"

# Option B: Stash them for later
git stash

# Option C: Discard them (be careful!)
git restore .
```

**⚠️ Critical**: Never switch branches with uncommitted changes unless you understand the consequences.

## Branch Creation Process

### 1. Start from Clean Main Branch

```bash
# Switch to main and ensure it's clean
git checkout main

# Handle any uncommitted changes first (see above)
# Then pull latest changes
git pull origin main
```

**Common Issues:**

- `error: cannot pull with rebase: You have unstaged changes` → Stash or commit first
- `error: cannot pull with rebase: Your index contains uncommitted changes` → Commit staged changes first

### 2. Create Feature Branch

```bash
# Create and switch to new branch
git checkout -b feature/descriptive-name

# Verify you're on the new branch
git branch --show-current
```

**Branch Naming Convention:**

- `feature/[description]` - New features
- `bugfix/[description]` - Bug fixes
- `docs/[description]` - Documentation updates
- `refactor/[description]` - Code refactoring
- `test/[description]` - Test-related changes

**Examples:**

- `feature/ui-refactor-tailwind-shadcn`
- `bugfix/sidebar-navigation-crash`
- `docs/api-documentation-update`

## Commit Process & PI Verification

### Understanding the Pre-Commit Hook

The project has a **pre-commit hook** that enforces Perfect Information (PI) standards:

**Location**: `.git/hooks/pre-commit`

**What it checks:**

1. **PI Verification**: Looks for "PI verified:" in commit message
2. **JSDoc**: Warns about new functions without documentation
3. **Format**: Enforces conventional commit format

### Proper Commit Message Format

**Required Structure:**

```
type(scope): brief description

- Implementation detail 1
- Implementation detail 2
- File paths modified

PI verified:
- What was checked and verified
- Specific verification steps taken
- Any assumptions validated
```

**Example:**

```
feat(ui): add Tailwind CSS configuration

- Installed tailwindcss@latest and @tailwindcss/vite@latest
- Configured Vite to use Tailwind plugin
- Created initial tailwind.config.js with theme mapping
- Updated package.json dependencies

PI verified:
- All file paths exist and are correct
- Dependencies installed successfully
- Vite configuration syntax validated
- No breaking changes to existing styles
```

### Commit Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

### Handling PI Verification Failures

**If you get this error:**

```
❌ Commit message missing PI verification
Required format:
type(scope): description

- Implementation details

PI verified:
- What was checked and verified
```

**Solutions:**

**Option 1: Use git commit (opens editor)**

```bash
git commit
# This opens your editor where you can write the full message
```

**Option 2: Use --no-verify (emergency only)**

```bash
git commit --no-verify -m "your message"
# Only use for documentation or non-code changes
```

**Option 3: Fix the message format**
Ensure your commit message includes:

- Conventional commit format
- Bullet points with details
- "PI verified:" section with actual verification steps

## Working with Multiple Branches

### Switching Between Branches

```bash
# Always check current state first
git status

# If clean, switch directly
git checkout other-branch

# If dirty, stash first
git stash
git checkout other-branch
# Later: git stash pop
```

### Keeping Feature Branch Updated

```bash
# From your feature branch
git checkout main
git pull origin main
git checkout feature/your-branch
git rebase main

# Or merge if you prefer
git merge main
```

## Documentation Requirements

### For Every Feature Branch

Create documentation in `docs/technical/[feature-name].md`:

**Required Sections:**

```markdown
# Feature Name

---

created: YYYY-MM-DDTHH:MM:SSZ
updated: YYYY-MM-DDTHH:MM:SSZ
updatedBy: [YourName]
version: 1.0.0
branch: feature/branch-name

---

## Overview

- What this feature does
- Why it's needed
- Timeline/scope

## Implementation Plan

- Phase-by-phase breakdown
- Dependencies
- Risk mitigation

## Files Modified

- List of all files changed
- Purpose of each change

## Testing Strategy

- How to test the changes
- What could break

## Next Steps

- What comes after this
```

### Commit the Documentation First

```bash
git add docs/technical/your-feature.md
git commit -m "docs(feature): add implementation plan

- Created comprehensive feature documentation
- Includes timeline and implementation strategy
- Documents all planned file changes

PI verified:
- Documentation follows project standards
- All sections completed
- Timeline is realistic"
```

## Push and PR Process

### Initial Push

```bash
# Push with upstream tracking
git push -u origin feature/your-branch-name
```

### Creating Pull Requests

The project has AI-powered workflows that will:

- Automatically review your PR
- Check for security issues
- Validate code quality
- Generate tests if needed

**PR Best Practices:**

- Link to related issues
- Include clear description
- Add screenshots for UI changes
- Mark as draft if not ready for review

## Common Gotchas & Solutions

### 1. "Cannot pull with rebase" Errors

**Problem**: Uncommitted changes prevent pulling
**Solution**: Always handle uncommitted changes first (commit, stash, or discard)

### 2. PI Verification Failures

**Problem**: Pre-commit hook rejects commits
**Solution**: Follow exact PI verification format with "PI verified:" section

### 3. Switching Branches with Changes

**Problem**: Changes follow you between branches
**Solution**: Always commit or stash before switching

### 4. Merge Conflicts

**Problem**: Conflicts when updating from main
**Solution**:

```bash
git status  # See conflicted files
# Edit files to resolve conflicts
git add .
git commit -m "resolve merge conflicts"
```

### 5. Wrong Branch for Changes

**Problem**: Made changes on wrong branch
**Solution**:

```bash
git stash
git checkout correct-branch
git stash pop
```

## AI Workflow Integration

### Using AI Workflows

The project has several AI workflows you can leverage:

**1. Issue to PR Workflow**

- Create GitHub issue with `ai-implement` label
- AI will create PR automatically

**2. Code Review Workflow**

- Automatic review on PR creation
- Security and quality checks

**3. Test Generation**

- Automatic test creation for new code

### Triggering AI Workflows

```bash
# Create issue first, then:
gh issue create --title "Feature: Your Feature" --label "ai-implement"
```

## Emergency Procedures

### Undo Last Commit (Not Pushed)

```bash
git reset --soft HEAD~1  # Keep changes staged
git reset --hard HEAD~1  # Discard changes completely
```

### Undo Last Commit (Already Pushed)

```bash
git revert HEAD  # Creates new commit that undoes the last one
```

### Force Push (Use Carefully)

```bash
git push --force-with-lease origin feature/your-branch
# Only on your own feature branches!
```

## Quick Reference Commands

```bash
# Start new feature
git checkout main && git pull && git checkout -b feature/name

# Check current state
git branch --show-current && git status

# Proper commit with PI
git add . && git commit  # Opens editor for full message

# Update feature branch
git checkout main && git pull && git checkout - && git rebase main

# Push new branch
git push -u origin feature/name

# Emergency stash
git stash && git checkout main
```

## Lessons Learned

### From UI Refactor Branch Creation

1. **Always check git status first** - Uncommitted changes will follow you
2. **Handle staged changes properly** - They prevent clean branch switching
3. **Use --no-verify sparingly** - Only for docs or emergency situations
4. **Document everything** - Create comprehensive docs before coding
5. **Follow naming conventions** - Use descriptive, consistent branch names
6. **Test the process** - Verify each step works before proceeding

### Best Practices Discovered

1. **Stash is your friend** - Use it liberally when switching contexts
2. **Commit early and often** - Small, focused commits are better
3. **PI verification is strict** - Follow the format exactly
4. **Documentation first** - Plan before implementing
5. **Use AI workflows** - Leverage the project's automation

---

**Remember**: This process exists to maintain code quality and project consistency. When in doubt, ask for help rather than bypassing safeguards.

**Created**: 2025-01-27 by v0-AI-Assistant  
**Based on**: Actual experience creating feature/ui-refactor-tailwind-shadcn branch  
**Status**: Complete process documentation with all gotchas covered
