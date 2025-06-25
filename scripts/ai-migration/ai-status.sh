#!/bin/bash

# AI Workflows Status Script
# Quick overview of AI workflow status and health

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get terminal width for formatting
TERM_WIDTH=$(tput cols 2>/dev/null || echo 80)

# Helper function to create separator lines
separator() {
    printf '%*s\n' "${TERM_WIDTH}" '' | tr ' ' "${1:-─}"
}

# Header
clear
echo -e "${CYAN}$(separator '═')${NC}"
echo -e "${CYAN}🤖 Neucleos AI Workflows Status Dashboard${NC}"
echo -e "${CYAN}$(separator '═')${NC}"
echo -e "Generated: $(date)"
echo

# 1. API Key Status
echo -e "${BLUE}📔 API Configuration${NC}"
separator
if gh secret list 2>/dev/null | grep -q "ANTHROPIC_API_KEY"; then
    echo -e "Anthropic API Key: ${GREEN}✅ Configured${NC}"
else
    echo -e "Anthropic API Key: ${RED}❌ Not configured${NC}"
fi

if gh secret list 2>/dev/null | grep -q "SENTRY_DSN"; then
    echo -e "Sentry Monitoring: ${GREEN}✅ Configured${NC}"
else
    echo -e "Sentry Monitoring: ${YELLOW}⚠️  Not configured (optional)${NC}"
fi
echo

# 2. Workflow Status
echo -e "${BLUE}🔄 Workflow Status${NC}"
separator

workflows=("AI PR Review" "AI Issue to PR" "AI Test Generation" "AI Docs Sync")
active_count=0
total_workflows=0

for workflow in "${workflows[@]}"; do
    if gh workflow view "$workflow" &>/dev/null; then
        total_workflows=$((total_workflows + 1))
        state=$(gh workflow view "$workflow" --json state -q .state 2>/dev/null)
        
        if [ "$state" = "active" ]; then
            echo -e "$workflow: ${GREEN}● Active${NC}"
            active_count=$((active_count + 1))
        elif [ "$state" = "disabled_manually" ]; then
            echo -e "$workflow: ${YELLOW}● Disabled${NC}"
        else
            echo -e "$workflow: ${RED}● Error${NC}"
        fi
    else
        echo -e "$workflow: ${YELLOW}○ Not installed${NC}"
    fi
done

echo -e "\nSummary: ${active_count}/${total_workflows} workflows active"
echo

# 3. Recent Activity (Last 24 hours)
echo -e "${BLUE}📊 Recent Activity (24h)${NC}"
separator

# Get runs from last 24 hours
yesterday=$(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ')

total_runs=0
successful_runs=0
failed_runs=0
in_progress=0

for workflow in "${workflows[@]}"; do
    if gh workflow view "$workflow" &>/dev/null; then
        runs=$(gh run list --workflow="$workflow" --json status,conclusion,createdAt --limit 50 2>/dev/null | \
               jq --arg yesterday "$yesterday" \
               '[.[] | select(.createdAt > $yesterday)]')
        
        workflow_total=$(echo "$runs" | jq 'length')
        workflow_success=$(echo "$runs" | jq '[.[] | select(.conclusion == "success")] | length')
        workflow_failed=$(echo "$runs" | jq '[.[] | select(.conclusion == "failure")] | length')
        workflow_progress=$(echo "$runs" | jq '[.[] | select(.status == "in_progress")] | length')
        
        if [ "$workflow_total" -gt 0 ]; then
            echo -e "$workflow: ${workflow_total} runs (${GREEN}${workflow_success}✓${NC} ${RED}${workflow_failed}✗${NC} ${YELLOW}${workflow_progress}⟳${NC})"
            
            total_runs=$((total_runs + workflow_total))
            successful_runs=$((successful_runs + workflow_success))
            failed_runs=$((failed_runs + workflow_failed))
            in_progress=$((in_progress + workflow_progress))
        fi
    fi
done

if [ $total_runs -eq 0 ]; then
    echo -e "${YELLOW}No workflow runs in the last 24 hours${NC}"
else
    success_rate=0
    if [ $total_runs -gt 0 ]; then
        completed_runs=$((successful_runs + failed_runs))
        if [ $completed_runs -gt 0 ]; then
            success_rate=$((successful_runs * 100 / completed_runs))
        fi
    fi
    
    echo
    echo "Total: ${total_runs} runs"
    echo -e "Success Rate: ${success_rate}% (${GREEN}${successful_runs}${NC}/${completed_runs})"
fi
echo

# 4. Current PRs with AI Review
echo -e "${BLUE}🔍 Active PRs${NC}"
separator

pr_count=$(gh pr list --json number,labels,isDraft | \
           jq '[.[] | select(.isDraft == false)] | length')
           
ai_reviewed=$(gh pr list --json number,labels,title,isDraft | \
              jq -r '[.[] | select(.isDraft == false) | select(.labels[]?.name == "ai-reviewed" or .labels[]?.name == "ai-approved" or .labels[]?.name == "ai-changes-requested")]')

ai_count=$(echo "$ai_reviewed" | jq 'length')

echo "Open PRs: ${pr_count}"
echo "With AI Review: ${ai_count}"

if [ "$ai_count" -gt 0 ]; then
    echo
    echo "Recent AI Reviews:"
    echo "$ai_reviewed" | jq -r '.[:3] | .[] | "  PR #\(.number): \(.title)"'
fi
echo

# 5. Cost Estimation
echo -e "${BLUE}💰 Cost Tracking${NC}"
separator

# Simple cost estimation based on activity
if [ $total_runs -gt 0 ]; then
    # Rough estimates
    pr_review_cost=0.50
    issue_impl_cost=2.00
    test_gen_cost=1.00
    
    estimated_daily_cost=$(echo "scale=2; $total_runs * 0.75" | bc 2>/dev/null || echo "N/A")
    estimated_monthly_cost=$(echo "scale=2; $estimated_daily_cost * 30" | bc 2>/dev/null || echo "N/A")
    
    echo "Estimated Daily Cost: \$${estimated_daily_cost}"
    echo "Projected Monthly Cost: \$${estimated_monthly_cost}"
    echo
    echo -e "${YELLOW}Note: These are rough estimates. Run cost-calculator.js for accurate projections.${NC}"
else
    echo "No recent activity to estimate costs"
fi
echo

# 6. System Health
echo -e "${BLUE}🏥 System Health${NC}"
separator

# Check for common issues
issues=0

# Check if any workflows are failing consistently
for workflow in "${workflows[@]}"; do
    if gh workflow view "$workflow" &>/dev/null; then
        recent_failures=$(gh run list --workflow="$workflow" --status=failure --limit=5 --json conclusion 2>/dev/null | jq 'length')
        if [ "$recent_failures" -ge 3 ]; then
            echo -e "${RED}⚠️  $workflow has multiple recent failures${NC}"
            issues=$((issues + 1))
        fi
    fi
done

# Check for stuck workflows
stuck_runs=$(gh run list --status=in_progress --json createdAt --limit 20 2>/dev/null | \
             jq --arg hour_ago "$(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-1H '+%Y-%m-%dT%H:%M:%SZ')" \
             '[.[] | select(.createdAt < $hour_ago)] | length')

if [ "$stuck_runs" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  ${stuck_runs} workflow runs may be stuck (>1 hour)${NC}"
    issues=$((issues + 1))
fi

if [ $issues -eq 0 ]; then
    echo -e "${GREEN}✅ All systems operational${NC}"
fi
echo

# 7. Quick Actions
echo -e "${BLUE}⚡ Quick Actions${NC}"
separator
echo "• View detailed costs:     ${CYAN}./scripts/ai-migration/cost-calculator.js${NC}"
echo "• Monitor in real-time:    ${CYAN}./scripts/ai-migration/monitor-dashboard.sh${NC}"
echo "• Emergency stop:          ${CYAN}./scripts/ai-migration/emergency-stop.sh${NC}"
echo "• Validate migration:      ${CYAN}./scripts/ai-migration/validate-migration.sh${NC}"
echo "• View specific workflow:  ${CYAN}gh workflow view \"AI PR Review\"${NC}"
echo "• View recent runs:        ${CYAN}gh run list --workflow=\"AI PR Review\"${NC}"
echo

# Footer
echo -e "${CYAN}$(separator '═')${NC}"
echo -e "For detailed monitoring, see ${GREEN}MIGRATION_GUIDE.md${NC}"
echo -e "Report issues in ${YELLOW}#ai-workflows${NC} channel"