# AutomatSEO GitHub Repository Setup Guide

This guide outlines the complete setup required for the AutomatSEO repository with proper branch protection and closed-source development workflow.

## ✅ Completed Configurations

### 1. Repository Identity
- ✅ Updated all workflows from `cherry-studio` to `automatseo`
- ✅ Fixed repository references in nightly builds
- ✅ Updated PR template and documentation references

### 2. Remote Configuration
- ✅ Disabled push to upstream (`git remote set-url --push upstream no_push`)
- ✅ Verified fetch from upstream remains functional

### 3. Legal Documentation
- ✅ Created proprietary LICENSE file
- ✅ Updated CONTRIBUTING.md for closed-source workflow
- ✅ Enhanced SECURITY.md with comprehensive policy

### 4. Enhanced Security & Workflows
- ✅ Added comprehensive branch protection workflow
- ✅ Enhanced security scanning with CodeQL and TruffleHog
- ✅ Quality gates with testing and coverage requirements

### 5. Configuration Files
- ✅ Updated CODEOWNERS for AutomatSEO maintainers
- ✅ Enhanced .gitattributes for cross-platform compatibility
- ✅ Improved Dependabot configuration with scheduled updates

## 🔧 Required GitHub Settings (Manual Setup)

### Branch Protection Rules

Navigate to **Settings > Branches > Branch protection rule** and configure:

#### Main Branch Protection
- **Branch name pattern**: `main`
- **Require status checks to pass before merging**: ✅
  - ✅ Require branches to be up to date before merging
  - ✅ Required status checks:
    - `build` (from PR CI)
    - `security-scan` (from branch protection)
    - `quality-gates` (from branch protection)
- **Require pull request reviews before merging**: ✅
  - Required approving reviews: **2**
  - ✅ Dismiss stale PR approvals when new commits are pushed
  - ✅ Require review from CODEOWNERS
  - ✅ Restrict pushes that create matching branches
- **Require administrator approval**: ❌ (Optional for your workflow)
- **Restrict who can push to matching branches**: ✅
  - **Allowed to push**: Only `imrshohel`

#### Develop Branch Protection
- **Branch name pattern**: `develop`
- **Require status checks to pass before merging**: ✅
  - ✅ Require branches to be up to date before merging
  - Required status checks: Same as main branch
- **Require pull request reviews before merging**: ✅
  - Required approving reviews: **1**
  - ✅ Dismiss stale PR approvals when new commits are pushed
- **Restrict who can push to matching branches**: ✅
  - **Allowed to push**: `imrshohel` and designated contributors

### Repository Settings

#### General Settings
- **Repository name**: `automatseo`
- **Description**: "Automated SEO optimization platform"
- **Website**: `https://automatseo.com` (when ready)
- **Visibility**: **Private** (for closed-source)

#### Collaboration Settings
- **Issues**: ✅ Enable
- **Discussions**: ✅ Enable (optional for community)
- **Projects**: ✅ Enable (optional for project management)
- **Security advisories**: ✅ Enable
- **Dependabot alerts**: ✅ Enable
- **Dependabot security updates**: ✅ Enable
- **Update branches**: ❌ Disable (for better control)

#### Actions Settings
- **Actions permissions**:
  - Allow all actions
  - Restrict actions from being approved by fork PRs
- **Fork pull request workflows from outside collaborators**: ❌ Disable
- **Allow GitHub Actions to create and approve pull requests**: ❌ Disable

### Required GitHub Secrets

Navigate to **Settings > Secrets and variables > Actions** and add:

#### Application Secrets
- `GITHUB_TOKEN`: (Already available)
- `TRANSLATE_API_KEY`: For i18n automation
- `MAIN_VITE_CHERRYAI_CLIENT_SECRET`: Replace with your AutomatSEO API keys
- `MAIN_VITE_MINERU_API_KEY`: Replace with your API keys
- `RENDERER_VITE_AIHUBMIX_SECRET`: Replace with your API keys
- `RENDERER_VITE_PPIO_APP_SECRET`: Replace with your API keys

#### Release Secrets
- `CSC_LINK`: For macOS code signing
- `CSC_KEY_PASSWORD`: For macOS code signing
- `APPLE_ID`: Apple Developer ID
- `APPLE_APP_SPECIFIC_PASSWORD`: App-specific password
- `APPLE_TEAM_ID`: Apple Developer Team ID

### Repository Variables

Navigate to **Settings > Secrets and variables > Actions > Variables**:

#### Configuration Variables
- `AUTO_I18N_MODEL`: `deepseek/deepseek-v3.1`
- `AUTO_I18N_BASE_URL`: `https://api.ppinfra.com/openai`
- `AUTO_I18N_BASE_LOCALE`: `en-us`

### Team and Access Management

#### Collaborator Management
- **Owner**: `imrshohel`
- **Maintainers**: Add additional maintainers as needed
- **Contributors**: Grant access to approved contributors only

#### Branch Permissions
- **Main branch**: Only owners/maintainers can push directly
- **Develop branch**: Maintainers + approved contributors
- **Feature branches**: Contributors can push to their own feature branches

## 🚀 Initial Setup Commands

```bash
# Verify remote configuration
git remote -v

# Set up local branches (if needed)
git checkout -b develop origin/develop
git checkout -b feature/initial-setup

# Commit all changes
git add .
git commit -m "feat: complete GitHub repository setup for AutomatSEO

- Updated repository identity from cherry-studio to automatseo
- Configured proprietary closed-source licensing
- Enhanced security workflows with CodeQL and TruffleHog
- Added comprehensive branch protection strategy
- Updated CODEOWNERS and configuration files
- Enhanced Dependabot configuration with scheduled updates
- Added cross-platform .gitattributes configuration

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"

# Push changes
git push origin main
```

## 📋 Ongoing Maintenance

### Weekly Tasks
- Review and merge Dependabot PRs
- Monitor security scan results
- Review pull requests requiring approval

### Monthly Tasks
- Update dependencies manually if needed
- Review and update branch protection rules
- Audit repository permissions

### Security Monitoring
- Monitor GitHub Security Advisories
- Review security scan results
- Update security policies as needed

## 🔄 Sync with Upstream

To sync changes from the original CherryStudio repository:

```bash
# Fetch latest changes from upstream
git fetch upstream

# Create a sync branch
git checkout -b sync/upstream-update

# Merge upstream changes
git merge upstream/main

# Resolve conflicts (if any)
# Review and test changes

# Create PR for review and merge
```

## 📞 Support

For questions or issues with this setup:

- **Documentation**: Check CONTRIBUTING.md and SECURITY.md
- **Issues**: Create GitHub issues (non-security related)
- **Security**: Email security@automatseo.com
- **General**: github@automatseo.com

---

**Note**: This setup is designed for a closed-source, proprietary development workflow while maintaining security best practices and efficient development processes.