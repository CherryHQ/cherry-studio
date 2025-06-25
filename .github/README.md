# GitHub Configuration

This directory contains GitHub-specific configuration files for the neucleos Cockpit project.

## Perfect Information (PI) Enforcement System

The PI enforcement system ensures code quality, security, and maintainability standards are met across the codebase.

### Quick Start

1. **Install required dependency** (if not already installed):
   ```bash
   yarn add --dev glob
   ```

2. **Run PI checks locally**:
   ```bash
   node scripts/pi-checker.js
   ```

3. **Run with auto-fix**:
   ```bash
   node scripts/pi-checker.js --fix
   ```

### Files in this Directory

- **workflows/pi-enforcement.yml** - GitHub Actions workflow that runs on all PRs
- **pi-standards.md** - Comprehensive documentation of all PI standards
- **README.md** - This file

### How It Works

1. **Automated Checks**: Every PR triggers the PI enforcement workflow
2. **Blocking**: PRs cannot be merged if PI checks fail
3. **Feedback**: Detailed comments are added to PRs explaining failures
4. **Local Testing**: Developers can run the same checks locally

### Key Standards Enforced

- ✅ **Code Documentation**: All exported functions, types, and components must be documented
- ✅ **Test Coverage**: Minimum 80% coverage, 100% for critical paths
- ✅ **Code Quality**: No console.logs, proper error handling, type safety
- ✅ **Security**: No hardcoded secrets, safe IPC usage, validated inputs
- ✅ **File Organization**: Consistent naming, proper structure, size limits
- ✅ **Commit Standards**: Conventional commits, atomic changes, signed commits

### Exemptions

Add exemptions when absolutely necessary:

1. **In code**: `// PI-EXEMPT: reason`
2. **In .pi-ignore**: For files/patterns to exclude

### Getting Help

- Read the full [PI Standards Documentation](./pi-standards.md)
- Check existing PRs for examples
- Ask in PR comments for clarification
- Contact maintainers for special cases

### Future Improvements

- [ ] Dashboard for PI metrics over time
- [ ] Integration with code review tools
- [ ] Automated fix suggestions
- [ ] Performance impact analysis
- [ ] Custom rules per team/module