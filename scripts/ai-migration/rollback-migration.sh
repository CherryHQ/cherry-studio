#!/bin/bash

# AI Workflows Migration Rollback Script
# Safely rollback AI workflow migration

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
BACKUP_BRANCH="backup/pre-ai-migration"
ROLLBACK_BRANCH="rollback/ai-workflows-$(date +%Y%m%d-%H%M%S)"

echo -e "${RED}🚨 AI Workflows Migration Rollback${NC}"
echo "===================================="
echo

# Confirmation
echo -e "${YELLOW}⚠️  WARNING: This will rollback all AI workflow changes${NC}"
echo "This action will:"
echo "  - Disable all AI workflows"
echo "  - Remove workflow files"
echo "  - Create a rollback record"
echo "  - Preserve current state for analysis"
echo
read -p "Are you sure you want to proceed? (yes/no): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    echo -e "${YELLOW}Rollback cancelled${NC}"
    exit 0
fi

# Create rollback documentation
create_rollback_record() {
    echo -e "\n${YELLOW}Creating rollback record...${NC}"
    
    mkdir -p .rollback
    
    cat > .rollback/rollback-$(date +%Y%m%d-%H%M%S).md << EOF
# AI Workflows Rollback Record

**Date**: $(date)
**Initiated by**: $(git config user.name)
**Branch**: $ROLLBACK_BRANCH

## Reason for Rollback
[To be filled by operator]

## State Before Rollback

### Active Workflows
$(gh workflow list | grep "AI " || echo "None found")

### Recent Runs
$(gh run list --limit 10 --json workflowName,status,conclusion,createdAt | \
  jq -r '.[] | select(.workflowName | startswith("AI ")) | 
  "\(.workflowName): \(.status) - \(.conclusion // "in progress") at \(.createdAt)"' || echo "None found")

### Configuration Files
- Workflows: $(ls -la .github/workflows/ai-*.yml 2>/dev/null | wc -l) files
- Templates: $(ls -la .github/ISSUE_TEMPLATE/ai-*.md 2>/dev/null | wc -l) files
- Scripts: $(ls -la scripts/ai-migration/*.sh 2>/dev/null | wc -l) files

## Actions Taken
1. Created rollback branch: $ROLLBACK_BRANCH
2. Disabled all AI workflows
3. Backed up current configuration
4. Removed AI workflow files
5. Updated documentation
EOF
}

# Step 1: Create rollback branch
echo -e "\n${YELLOW}Step 1: Creating rollback branch...${NC}"
git checkout -b "$ROLLBACK_BRANCH"
echo -e "${GREEN}✅ Created branch: $ROLLBACK_BRANCH${NC}"

# Step 2: Backup current state
echo -e "\n${YELLOW}Step 2: Backing up current state...${NC}"
mkdir -p .backup/rollback

# Backup workflows
if [ -d .github/workflows ]; then
    cp -r .github/workflows .backup/rollback/
    echo -e "${GREEN}✅ Workflows backed up${NC}"
fi

# Backup issue templates
if [ -d .github/ISSUE_TEMPLATE ]; then
    cp -r .github/ISSUE_TEMPLATE .backup/rollback/
    echo -e "${GREEN}✅ Issue templates backed up${NC}"
fi

# Backup scripts
if [ -d scripts/ai-migration ]; then
    cp -r scripts/ai-migration .backup/rollback/
    echo -e "${GREEN}✅ Scripts backed up${NC}"
fi

# Step 3: Disable all AI workflows
echo -e "\n${YELLOW}Step 3: Disabling AI workflows...${NC}"
for workflow in "AI PR Review" "AI Issue to PR" "AI Test Generation" "AI Docs Sync"; do
    echo -n "Disabling $workflow... "
    if gh workflow disable "$workflow" 2>/dev/null; then
        echo -e "${GREEN}✅${NC}"
    else
        echo -e "${YELLOW}(not found or already disabled)${NC}"
    fi
done

# Cancel any running workflows
echo -e "\n${YELLOW}Cancelling active workflow runs...${NC}"
active_runs=0
for workflow in "AI PR Review" "AI Issue to PR" "AI Test Generation" "AI Docs Sync"; do
    for run in $(gh run list --workflow="$workflow" --status="in_progress" --json databaseId -q '.[].databaseId' 2>/dev/null); do
        echo "Cancelling run $run..."
        gh run cancel $run
        active_runs=$((active_runs + 1))
    done
done

if [ $active_runs -eq 0 ]; then
    echo -e "${GREEN}✅ No active runs to cancel${NC}"
else
    echo -e "${GREEN}✅ Cancelled $active_runs active runs${NC}"
fi

# Step 4: Remove AI workflow files
echo -e "\n${YELLOW}Step 4: Removing AI workflow files...${NC}"

# Remove workflow files
removed_count=0
for file in .github/workflows/ai-*.yml; do
    if [ -f "$file" ]; then
        git rm "$file" 2>/dev/null || rm "$file"
        echo "  Removed: $file"
        removed_count=$((removed_count + 1))
    fi
done

# Remove issue templates
for file in .github/ISSUE_TEMPLATE/ai-*.md; do
    if [ -f "$file" ]; then
        git rm "$file" 2>/dev/null || rm "$file"
        echo "  Removed: $file"
        removed_count=$((removed_count + 1))
    fi
done

echo -e "${GREEN}✅ Removed $removed_count AI-related files${NC}"

# Step 5: Create rollback documentation
create_rollback_record

# Step 6: Update main documentation
echo -e "\n${YELLOW}Step 6: Updating documentation...${NC}"

# Add rollback notice to README if it exists
if [ -f README.md ]; then
    # Check if rollback notice already exists
    if ! grep -q "AI Workflows Rollback Notice" README.md; then
        cat >> README.md << EOF

---

### ⚠️ AI Workflows Rollback Notice

AI-driven GitHub workflows were rolled back on $(date +%Y-%m-%d). 
See \`.rollback/\` directory for details.
EOF
        echo -e "${GREEN}✅ Updated README.md${NC}"
    fi
fi

# Step 7: Commit changes
echo -e "\n${YELLOW}Step 7: Committing rollback...${NC}"
git add -A
git commit -m "rollback: remove AI workflows

- Disabled all AI-driven workflows
- Removed workflow files and templates
- Created rollback documentation
- Preserved backup in .backup/rollback/

Rollback initiated due to: [specify reason]" || echo "No changes to commit"

# Step 8: Create PR for rollback
echo -e "\n${YELLOW}Step 8: Creating rollback PR...${NC}"
echo "Would you like to create a PR for this rollback? (y/n)"
read -r CREATE_PR

if [[ "$CREATE_PR" == "y" ]]; then
    git push origin "$ROLLBACK_BRANCH"
    
    pr_body="## 🚨 AI Workflows Rollback

This PR removes all AI-driven GitHub workflows from the repository.

### Reason for Rollback
[Please specify the reason for this rollback]

### Changes
- Disabled all AI workflows
- Removed workflow files from \`.github/workflows/\`
- Removed AI-specific issue templates
- Created rollback documentation in \`.rollback/\`
- Backed up configuration to \`.backup/rollback/\`

### Verification
- [ ] All AI workflows are disabled
- [ ] No active workflow runs remain
- [ ] Documentation has been updated
- [ ] Team has been notified

### Next Steps
1. Review and merge this PR
2. Notify the team about the rollback
3. Schedule post-mortem meeting
4. Update migration documentation

/cc @team-lead @devops"

    gh pr create \
        --title "🚨 Rollback: Remove AI workflows" \
        --body "$pr_body" \
        --label "rollback,urgent" \
        --draft
        
    echo -e "${GREEN}✅ Draft PR created${NC}"
fi

# Step 9: Generate summary report
echo -e "\n${YELLOW}Step 9: Generating summary report...${NC}"

cat > rollback-summary.txt << EOF
AI WORKFLOWS ROLLBACK SUMMARY
============================
Date: $(date)
Branch: $ROLLBACK_BRANCH

Actions Completed:
✅ Created rollback branch
✅ Backed up current configuration
✅ Disabled all AI workflows
✅ Cancelled $active_runs active runs
✅ Removed $removed_count AI-related files
✅ Created rollback documentation
✅ Updated repository documentation

Backup Location: .backup/rollback/
Rollback Record: .rollback/rollback-$(date +%Y%m%d-%H%M%S).md

Next Steps:
1. Fill in rollback reason in documentation
2. Review and merge rollback PR (if created)
3. Notify team members
4. Remove GitHub secrets if needed:
   gh secret delete ANTHROPIC_API_KEY
5. Schedule post-mortem meeting

To restore AI workflows later:
1. Check out the backup branch: git checkout $BACKUP_BRANCH
2. Copy files from .backup/rollback/
3. Re-enable workflows
4. Update configuration as needed
EOF

cat rollback-summary.txt

# Final message
echo -e "\n${GREEN}✅ Rollback completed successfully!${NC}"
echo -e "${YELLOW}⚠️  Don't forget to:${NC}"
echo "  1. Fill in the rollback reason in .rollback/"
echo "  2. Notify your team about the rollback"
echo "  3. Review and merge the rollback PR (if created)"
echo "  4. Consider removing API keys from GitHub secrets"
echo
echo -e "Summary saved to: ${BLUE}rollback-summary.txt${NC}"