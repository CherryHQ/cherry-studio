# AI Workflows Rollback Plan

## Table of Contents

1. [Overview](#overview)
2. [Rollback Triggers](#rollback-triggers)
3. [Immediate Actions](#immediate-actions)
4. [Phased Rollback](#phased-rollback)
5. [Data Recovery](#data-recovery)
6. [Communication Plan](#communication-plan)
7. [Post-Rollback Analysis](#post-rollback-analysis)

## Overview

This document provides a comprehensive rollback plan for AI-driven GitHub workflows. Use this plan when AI workflows cause critical issues or unexpected costs.

### Rollback Principles

- **Safety First**: Prioritize system stability over feature availability
- **Data Preservation**: Never lose code reviews, comments, or PR history
- **Gradual Rollback**: Disable features incrementally when possible
- **Clear Communication**: Keep all stakeholders informed

## Rollback Triggers

### Critical Triggers (Immediate Rollback)

1. **Security Breach**
   - AI suggests code with security vulnerabilities
   - API keys exposed in logs or comments
   - Unauthorized repository access

2. **Cost Overrun**
   - Daily costs exceed 200% of budget
   - Unexpected API usage spike
   - Billing alerts triggered

3. **System Failure**
   - Workflows blocking all PRs
   - Infinite loop in automation
   - GitHub Actions queue backed up

4. **Data Corruption**
   - AI modifying code incorrectly
   - Loss of PR history or comments
   - Merge conflicts from AI PRs

### Warning Triggers (Partial Rollback)

1. **Performance Issues**
   - Review time > 10 minutes
   - High failure rate (>30%)
   - Timeouts on small PRs

2. **Quality Issues**
   - High false positive rate
   - Inconsistent reviews
   - Team dissatisfaction

3. **Integration Problems**
   - Conflicts with other tools
   - API compatibility issues
   - Rate limiting problems

## Immediate Actions

### Step 1: Stop All AI Workflows (< 2 minutes)

```bash
#!/bin/bash
# Emergency stop script

echo "🚨 Initiating emergency AI workflow shutdown..."

# Disable all AI workflows
gh workflow disable "AI PR Review"
gh workflow disable "AI Issue to PR"
gh workflow disable "AI Test Generation"
gh workflow disable "AI Docs Sync"

# Cancel running workflows
for run in $(gh run list --workflow="AI PR Review" --status="in_progress" --json databaseId -q '.[].databaseId'); do
  gh run cancel $run
done

echo "✅ All AI workflows disabled"
```

### Step 2: Secure API Keys (< 5 minutes)

```bash
# Rotate compromised keys
echo "🔐 Rotating API keys..."

# Delete current key from GitHub
gh secret delete ANTHROPIC_API_KEY

# Generate new key (manual step - do this in Anthropic console)
echo "⚠️  Generate new API key at: https://console.anthropic.com/account/keys"

# Update local config
rm -f .env.local
echo "ANTHROPIC_API_KEY=sk-ant-new-key-here" > .env.local.example
```

### Step 3: Preserve Current State (< 10 minutes)

```bash
# Backup current state
echo "💾 Backing up current state..."

# Create rollback branch
git checkout -b rollback/ai-workflows-$(date +%Y%m%d-%H%M%S)

# Save workflow files
mkdir -p .backup/workflows
cp .github/workflows/ai-*.yml .backup/workflows/

# Document current issues
cat > .backup/ROLLBACK_REASON.md << EOF
# AI Workflow Rollback - $(date)

## Reason for Rollback
[Document the specific issue that triggered rollback]

## Affected Systems
- [ ] PR Reviews
- [ ] Issue Implementation
- [ ] Test Generation
- [ ] Documentation

## Impact
- PRs affected: [number]
- Issues affected: [number]
- Estimated downtime: [duration]

## Resolution Steps Taken
1. Disabled all AI workflows
2. Cancelled in-progress runs
3. Backed up configuration
EOF

git add .backup/
git commit -m "backup: AI workflow state before rollback"
git push origin rollback/ai-workflows-$(date +%Y%m%d-%H%M%S)
```

## Phased Rollback

### Phase 1: Disable Non-Critical Features (5-15 minutes)

```yaml
# Keep only essential workflows running
# In .github/workflows/ai-pr-review.yml

on:
  workflow_dispatch:  # Manual trigger only
  # pull_request:  # Commented out - disabled auto-trigger
  #   types: [opened, synchronize, reopened]

env:
  ENABLED_FEATURES: ['security_only']  # Minimal feature set
  MAX_FILE_SIZE: 100  # Reduced from 2000
  MAX_FILES: 5  # Reduced from 50
```

### Phase 2: Switch to Manual Mode (15-30 minutes)

```bash
#!/bin/bash
# Convert to manual approval mode

# Update all AI workflows to require approval
for workflow in .github/workflows/ai-*.yml; do
  # Add manual approval job
  yq eval '.jobs.approve = {
    "runs-on": "ubuntu-latest",
    "steps": [{
      "name": "Manual Approval Required",
      "uses": "trstringer/manual-approval@v1",
      "with": {
        "approvers": "senior-devs,team-leads"
      }
    }]
  }' -i "$workflow"
  
  # Make other jobs depend on approval
  yq eval '.jobs.*.needs = ["approve"]' -i "$workflow"
done

git add .github/workflows/
git commit -m "fix: require manual approval for AI workflows"
git push
```

### Phase 3: Implement Fallback Systems (30-60 minutes)

```yaml
# Enable traditional code review reminders
# .github/workflows/review-reminder.yml

name: Review Reminder (Fallback)
on:
  pull_request:
    types: [opened, ready_for_review]

jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - name: Post review reminder
        uses: actions/github-script@v7
        with:
          script: |
            const pr = context.payload.pull_request
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: pr.number,
              body: `👋 This PR is ready for human review.
              
              **AI workflows are currently disabled**
              Please review manually:
              - [ ] Security implications
              - [ ] Performance impact
              - [ ] Code quality
              - [ ] Test coverage`
            })
```

## Data Recovery

### Recover Lost PR Reviews

```javascript
// scripts/recover-reviews.js
const { Octokit } = require('@octokit/rest')
const fs = require('fs')

async function recoverReviews() {
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
  })
  
  // Get all PRs from last 7 days
  const prs = await octokit.paginate(octokit.pulls.list, {
    owner: 'neucleos',
    repo: 'cockpit-electron',
    state: 'all',
    sort: 'updated',
    direction: 'desc',
    per_page: 100
  })
  
  const aiReviews = []
  
  for (const pr of prs) {
    // Find AI reviews
    const reviews = await octokit.pulls.listReviews({
      owner: 'neucleos',
      repo: 'cockpit-electron',
      pull_number: pr.number
    })
    
    const aiReview = reviews.data.find(r => 
      r.user.login === 'github-actions[bot]' &&
      r.body.includes('🤖 AI Code Review')
    )
    
    if (aiReview) {
      aiReviews.push({
        pr: pr.number,
        title: pr.title,
        review: aiReview.body,
        date: aiReview.submitted_at
      })
    }
  }
  
  // Save recovered reviews
  fs.writeFileSync(
    'recovered-ai-reviews.json',
    JSON.stringify(aiReviews, null, 2)
  )
  
  console.log(`Recovered ${aiReviews.length} AI reviews`)
}

recoverReviews().catch(console.error)
```

### Restore Workflow History

```bash
#!/bin/bash
# Export workflow run history

echo "📊 Exporting workflow history..."

# Export all AI workflow runs
for workflow in "AI PR Review" "AI Issue to PR" "AI Test Generation"; do
  echo "Exporting $workflow..."
  gh run list \
    --workflow="$workflow" \
    --limit 1000 \
    --json databaseId,status,conclusion,createdAt,updatedAt,event,headBranch \
    > "workflow-history-$(echo $workflow | tr ' ' '-').json"
done

# Create summary report
cat > workflow-summary.md << EOF
# AI Workflow History Summary

Generated: $(date)

## Workflow Statistics

$(for file in workflow-history-*.json; do
  workflow=$(echo $file | sed 's/workflow-history-//;s/.json//;s/-/ /g')
  total=$(jq length $file)
  successful=$(jq '[.[] | select(.conclusion == "success")] | length' $file)
  failed=$(jq '[.[] | select(.conclusion == "failure")] | length' $file)
  
  echo "### $workflow"
  echo "- Total runs: $total"
  echo "- Successful: $successful"
  echo "- Failed: $failed"
  echo "- Success rate: $(( successful * 100 / total ))%"
  echo ""
done)
EOF
```

## Communication Plan

### Internal Communication

```markdown
# Slack/Teams Announcement Template

🚨 **AI Workflow Rollback in Progress**

**Status**: [Active/Resolved]
**Severity**: [Critical/High/Medium]
**Impact**: [Brief description]

**What Happened**:
[2-3 sentences explaining the issue]

**Current Actions**:
- ✅ AI workflows disabled
- ✅ Manual review process activated
- 🔄 Investigation ongoing

**What You Need to Do**:
- Review PRs manually until further notice
- Report any anomalies to #dev-support
- Check workflow-status channel for updates

**ETA for Resolution**: [timeframe]

Questions? Contact @[tech-lead] or #dev-support
```

### External Communication

```markdown
# GitHub Status Update

## AI-Assisted Features Temporarily Disabled

We've temporarily disabled AI-assisted features while we investigate [issue description].

**Affected Features**:
- Automated PR reviews
- Issue-to-PR conversion
- Test generation
- Documentation updates

**Impact**:
- PRs will require manual review
- Issues must be implemented manually
- No automated test generation

**Timeline**:
- Issue detected: [timestamp]
- Features disabled: [timestamp]
- Expected resolution: [timeframe]

We apologize for any inconvenience. Updates will be posted here.
```

### Stakeholder Updates

```python
# scripts/send-stakeholder-updates.py
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_rollback_notification(recipients, severity, eta):
    subject = f"[{severity}] AI Workflows Rollback - Action Required"
    
    body = f"""
    Dear Stakeholders,
    
    We have initiated a rollback of AI-driven workflows due to {reason}.
    
    Impact:
    - Development velocity may be reduced
    - Manual code reviews required
    - Potential delays in feature delivery
    
    Timeline:
    - Rollback initiated: {timestamp}
    - Expected resolution: {eta}
    - Full post-mortem: Within 48 hours
    
    Action Items:
    - Review critical PRs manually
    - Postpone non-critical deployments
    - Monitor status updates
    
    We will send hourly updates until resolved.
    
    Technical Team
    """
    
    # Send emails
    send_email(recipients, subject, body)
```

## Post-Rollback Analysis

### Incident Report Template

```markdown
# AI Workflow Incident Report

**Incident ID**: AIW-2025-001
**Date**: [Date]
**Duration**: [Start] - [End]
**Severity**: [Critical/High/Medium/Low]

## Executive Summary
[1-2 paragraphs summarizing the incident]

## Timeline
- **[Time]**: Issue first detected
- **[Time]**: Rollback initiated
- **[Time]**: Services restored
- **[Time]**: Full resolution

## Root Cause Analysis

### Technical Cause
[Detailed technical explanation]

### Contributing Factors
1. [Factor 1]
2. [Factor 2]
3. [Factor 3]

## Impact Assessment

### Quantitative Impact
- PRs affected: [number]
- Downtime: [duration]
- Cost overrun: $[amount]
- Developer hours lost: [hours]

### Qualitative Impact
- Team morale: [assessment]
- Customer trust: [assessment]
- Technical debt: [assessment]

## Lessons Learned

### What Went Well
1. [Positive aspect 1]
2. [Positive aspect 2]

### What Went Wrong
1. [Issue 1]
2. [Issue 2]

### Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|---------|
| [Action 1] | [Name] | [Date] | [Status] |
| [Action 2] | [Name] | [Date] | [Status] |

## Prevention Measures

### Short-term (< 1 week)
1. [Measure 1]
2. [Measure 2]

### Long-term (< 1 month)
1. [Measure 1]
2. [Measure 2]

## Appendices
- A. Full system logs
- B. Cost analysis
- C. User feedback
```

### Recovery Validation

```bash
#!/bin/bash
# Validate system recovery

echo "🔍 Validating system recovery..."

# Check workflow status
echo "Checking workflow status..."
for workflow in "AI PR Review" "AI Issue to PR" "AI Test Generation"; do
  status=$(gh workflow view "$workflow" --json state -q .state)
  echo "- $workflow: $status"
done

# Check recent PRs
echo -e "\nChecking recent PRs..."
recent_prs=$(gh pr list --limit 5 --json number,title,isDraft)
echo "$recent_prs" | jq -r '.[] | "- PR #\(.number): \(.title) (Draft: \(.isDraft))"'

# Check API key validity
echo -e "\nChecking API configuration..."
if [[ -z "$ANTHROPIC_API_KEY" ]]; then
  echo "❌ API key not configured"
else
  echo "✅ API key configured"
fi

# Generate recovery report
cat > recovery-report.md << EOF
# System Recovery Report

Generated: $(date)

## Recovery Status
- Workflows: [Disabled/Enabled]
- API Keys: [Rotated/Original]
- PRs Processing: [Manual/Automated]
- Team Notified: [Yes/No]

## Next Steps
1. Monitor system for 24 hours
2. Gradually re-enable features
3. Conduct post-mortem
4. Update runbooks

## Sign-off
- Tech Lead: ___________
- DevOps: ___________
- Product: ___________
EOF

echo -e "\n✅ Recovery validation complete. See recovery-report.md"
```

## Quick Reference Card

### Emergency Contacts

- **On-Call Engineer**: +1-XXX-XXX-XXXX
- **GitHub Support**: https://support.github.com
- **Anthropic Support**: support@anthropic.com
- **Escalation**: CTO / VP Engineering

### Critical Commands

```bash
# Disable all AI workflows
./scripts/emergency-stop.sh

# Check workflow status
gh workflow list | grep AI

# Cancel all runs
./scripts/cancel-all-ai-runs.sh

# Rotate API keys
./scripts/rotate-api-keys.sh

# Generate incident report
./scripts/generate-incident-report.sh
```

### Recovery Checklist

- [ ] All AI workflows disabled
- [ ] Running workflows cancelled
- [ ] API keys rotated (if needed)
- [ ] Team notified via Slack/Teams
- [ ] Status page updated
- [ ] Backup branch created
- [ ] Incident report started
- [ ] Post-mortem scheduled

Remember: **Stay calm, communicate clearly, and document everything!**