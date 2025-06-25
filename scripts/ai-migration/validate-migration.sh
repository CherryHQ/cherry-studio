#!/bin/bash

# AI Workflows Migration Validation Script
# Validates that the migration was successful and all components are working

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNINGS=0

# Check function
check() {
    local description="$1"
    local command="$2"
    local expected="$3"
    
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    
    echo -ne "Checking ${description}... "
    
    if eval "$command"; then
        echo -e "${GREEN}✅ PASSED${NC}"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
        return 0
    else
        echo -e "${RED}❌ FAILED${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

# Warning function
warn() {
    local description="$1"
    local command="$2"
    
    echo -ne "Checking ${description}... "
    
    if eval "$command"; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${YELLOW}⚠️  WARNING${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
}

echo -e "${BLUE}🔍 Neucleos AI Workflows Migration Validation${NC}"
echo "=============================================="
echo

# Prerequisites checks
echo -e "${YELLOW}1. Prerequisites${NC}"
echo "----------------"
check "GitHub CLI installed" "command -v gh > /dev/null 2>&1"
check "GitHub CLI authenticated" "gh auth status > /dev/null 2>&1"
check "Git repository" "git rev-parse --git-dir > /dev/null 2>&1"
check "Node.js installed" "command -v node > /dev/null 2>&1"
echo

# GitHub Secrets checks
echo -e "${YELLOW}2. GitHub Secrets${NC}"
echo "-----------------"
check "ANTHROPIC_API_KEY exists" "gh secret list | grep -q ANTHROPIC_API_KEY"
warn "SENTRY_DSN exists (optional)" "gh secret list | grep -q SENTRY_DSN"
warn "GH_PAT exists (optional)" "gh secret list | grep -q GH_PAT"
echo

# Workflow files checks
echo -e "${YELLOW}3. Workflow Files${NC}"
echo "-----------------"
check "Workflows directory exists" "[ -d .github/workflows ]"
check "AI PR Review workflow exists" "[ -f .github/workflows/ai-pr-review.yml ]"
warn "AI Issue to PR workflow exists" "[ -f .github/workflows/ai-issue-to-pr.yml ]"
warn "AI Test Generation workflow exists" "[ -f .github/workflows/ai-test-generation.yml ]"
warn "AI Docs Sync workflow exists" "[ -f .github/workflows/ai-docs-sync.yml ]"
echo

# Issue templates checks
echo -e "${YELLOW}4. Issue Templates${NC}"
echo "------------------"
check "Issue templates directory exists" "[ -d .github/ISSUE_TEMPLATE ]"
warn "AI feature template exists" "[ -f .github/ISSUE_TEMPLATE/ai-feature.md ]"
warn "AI bug template exists" "[ -f .github/ISSUE_TEMPLATE/ai-bug.md ]"
echo

# Helper scripts checks
echo -e "${YELLOW}5. Helper Scripts${NC}"
echo "-----------------"
check "Migration scripts directory exists" "[ -d scripts/ai-migration ]"
check "Setup script exists" "[ -f scripts/ai-migration/setup-ai-workflows.sh ]"
check "Cost calculator exists" "[ -f scripts/ai-migration/cost-calculator.js ]"
check "Emergency stop script exists" "[ -f scripts/ai-migration/emergency-stop.sh ]"
check "Monitor dashboard exists" "[ -f scripts/ai-migration/monitor-dashboard.sh ]"
check "Scripts are executable" "[ -x scripts/ai-migration/setup-ai-workflows.sh ]"
echo

# Workflow status checks
echo -e "${YELLOW}6. Workflow Status${NC}"
echo "------------------"
if [ -f .github/workflows/ai-pr-review.yml ]; then
    workflow_state=$(gh workflow view "AI PR Review" --json state -q .state 2>/dev/null || echo "not_found")
    if [ "$workflow_state" = "active" ]; then
        echo -e "AI PR Review workflow: ${GREEN}✅ ACTIVE${NC}"
    elif [ "$workflow_state" = "disabled_manually" ]; then
        echo -e "AI PR Review workflow: ${YELLOW}⚠️  DISABLED${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "AI PR Review workflow: ${RED}❌ NOT FOUND${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    fi
else
    echo -e "AI PR Review workflow: ${YELLOW}⚠️  NOT CONFIGURED${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo

# Documentation checks
echo -e "${YELLOW}7. Documentation${NC}"
echo "----------------"
check "Migration guide exists" "[ -f MIGRATION_GUIDE.md ]"
check "Rollback plan exists" "[ -f ROLLBACK_PLAN.md ]"
check "Migration checklist exists" "[ -f MIGRATION_CHECKLIST.md ]"
echo

# Configuration validation
echo -e "${YELLOW}8. Configuration${NC}"
echo "-----------------"

# Check workflow configuration
if [ -f .github/workflows/ai-pr-review.yml ]; then
    echo -n "Checking AI PR Review configuration... "
    
    # Check for required environment variables
    if grep -q "CLAUDE_MODEL:" .github/workflows/ai-pr-review.yml && \
       grep -q "MAX_REVIEW_COST:" .github/workflows/ai-pr-review.yml; then
        echo -e "${GREEN}✅ VALID${NC}"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
    else
        echo -e "${RED}❌ INVALID${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
    fi
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
fi
echo

# Cost estimation
echo -e "${YELLOW}9. Cost Analysis${NC}"
echo "----------------"
if [ -f scripts/ai-migration/cost-calculator.js ]; then
    echo "Running cost calculator..."
    if node scripts/ai-migration/cost-calculator.js > /tmp/cost-estimate.txt 2>&1; then
        echo -e "${GREEN}✅ Cost estimation successful${NC}"
        echo "Estimated costs:"
        grep "Total" /tmp/cost-estimate.txt | sed 's/^/  /'
    else
        echo -e "${YELLOW}⚠️  Cost calculator failed${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${YELLOW}⚠️  Cost calculator not found${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo

# Recent activity check
echo -e "${YELLOW}10. Recent Activity${NC}"
echo "-------------------"
echo "Checking for recent AI workflow runs..."

recent_runs=$(gh run list --workflow="AI PR Review" --limit 5 --json conclusion,createdAt 2>/dev/null | jq length)
if [ "$recent_runs" -gt 0 ]; then
    echo -e "${GREEN}✅ Found $recent_runs recent workflow runs${NC}"
    
    # Show success rate
    successful=$(gh run list --workflow="AI PR Review" --limit 20 --json conclusion 2>/dev/null | jq '[.[] | select(.conclusion == "success")] | length')
    total=$(gh run list --workflow="AI PR Review" --limit 20 --json conclusion 2>/dev/null | jq length)
    
    if [ "$total" -gt 0 ]; then
        success_rate=$((successful * 100 / total))
        echo "  Success rate: ${success_rate}% ($successful/$total)"
    fi
else
    echo -e "${YELLOW}⚠️  No recent workflow runs found${NC}"
    echo "  This is normal for new installations"
fi
echo

# Summary
echo -e "${BLUE}📊 Validation Summary${NC}"
echo "===================="
echo -e "Total checks: ${TOTAL_CHECKS}"
echo -e "Passed: ${GREEN}${PASSED_CHECKS}${NC}"
echo -e "Failed: ${RED}${FAILED_CHECKS}${NC}"
echo -e "Warnings: ${YELLOW}${WARNINGS}${NC}"
echo

# Overall result
if [ $FAILED_CHECKS -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo -e "${GREEN}✅ All checks passed! Migration is complete.${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠️  Migration complete with warnings.${NC}"
        echo "Review the warnings above and address if needed."
        exit 0
    fi
else
    echo -e "${RED}❌ Migration validation failed!${NC}"
    echo "Please fix the issues above before proceeding."
    exit 1
fi