# Branch Protection Configuration

## Main Branch Protection

Go to **Settings > Branches > Branch protection rule** and configure:

### Basic Settings
- **Branch name pattern**: `main`
- **Require status checks to pass before merging**: ✅
- **Require pull request reviews before merging**: ✅
- **Require conversation resolution before merging**: ✅

### Status Checks
- ✅ **Require branches to be up to date before merging**
- **Required status checks**:
  ```
  build                    (from PR CI workflow)
  security-scan           (from branch protection workflow)
  quality-gates           (from branch protection workflow)
  ```

### Pull Request Reviews
- **Required approving reviews**: **2**
- ✅ **Dismiss stale PR approvals when new commits are pushed**
- ✅ **Require review from CODEOWNERS**
- ✅ **Limit to users with write access**
- ✅ **Require review from CODEOWNERS**

### Additional Restrictions
- **Restrict pushes that create matching branches**: ✅
- **Allow force pushes**: ❌
- **Require linear history**: ✅
- **Do not allow bypassing the above settings**: ❌

## Develop Branch Protection

Create another rule with:
- **Branch name pattern**: `develop`
- **Required approving reviews**: **1**
- Same status checks as main branch

## Feature Branch Pattern

Create a rule for feature branches:
- **Branch name pattern**: `feature/*`
- **Required approving reviews**: **1**
- **Require status checks**: ❌ (optional for feature branches)

## Who Can Push

Add these usernames for push access:
- `imrshohel` (you)
- Additional team members as needed

## Enforcement

Once configured, these rules will:
- Prevent direct pushes to main/develop
- Require PR reviews
- Ensure all checks pass
- Protect against accidental deletions
- Maintain code quality standards

## Testing

After configuration:
1. Create a test branch
2. Try to push directly to main (should fail)
3. Create a PR and verify checks run
4. Test the approval process