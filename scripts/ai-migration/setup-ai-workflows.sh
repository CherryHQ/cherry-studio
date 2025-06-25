#!/bin/bash

# AI Workflows Setup Script
# This script automates the initial setup of AI-driven GitHub workflows

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKFLOWS_DIR="$REPO_ROOT/.github/workflows"
TEMPLATES_DIR="$REPO_ROOT/scripts/ai-migration/templates"

echo -e "${GREEN}🚀 Neucleos AI Workflows Setup${NC}"
echo "=================================="

# Check prerequisites
check_prerequisites() {
    echo -e "\n${YELLOW}Checking prerequisites...${NC}"
    
    # Check if gh CLI is installed
    if ! command -v gh &> /dev/null; then
        echo -e "${RED}❌ GitHub CLI (gh) is not installed${NC}"
        echo "Install from: https://cli.github.com/"
        exit 1
    fi
    
    # Check if authenticated
    if ! gh auth status &> /dev/null; then
        echo -e "${RED}❌ Not authenticated with GitHub${NC}"
        echo "Run: gh auth login"
        exit 1
    fi
    
    # Check if in git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        echo -e "${RED}❌ Not in a git repository${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All prerequisites met${NC}"
}

# Create workflow directory
setup_directories() {
    echo -e "\n${YELLOW}Setting up directories...${NC}"
    
    mkdir -p "$WORKFLOWS_DIR"
    mkdir -p "$TEMPLATES_DIR"
    mkdir -p "$REPO_ROOT/.github/ISSUE_TEMPLATE"
    
    echo -e "${GREEN}✅ Directories created${NC}"
}

# Set up GitHub secrets
setup_secrets() {
    echo -e "\n${YELLOW}Setting up GitHub secrets...${NC}"
    
    # Check if ANTHROPIC_API_KEY is set
    if gh secret list | grep -q "ANTHROPIC_API_KEY"; then
        echo -e "${GREEN}✅ ANTHROPIC_API_KEY already exists${NC}"
    else
        echo -e "${YELLOW}Please enter your Anthropic API key:${NC}"
        read -s ANTHROPIC_KEY
        echo
        
        if [[ -z "$ANTHROPIC_KEY" ]]; then
            echo -e "${RED}❌ API key cannot be empty${NC}"
            exit 1
        fi
        
        echo "$ANTHROPIC_KEY" | gh secret set ANTHROPIC_API_KEY
        echo -e "${GREEN}✅ ANTHROPIC_API_KEY added${NC}"
    fi
    
    # Optional: Set up Sentry DSN
    echo -e "\n${YELLOW}Do you want to set up Sentry monitoring? (y/n)${NC}"
    read -r SETUP_SENTRY
    
    if [[ "$SETUP_SENTRY" == "y" ]]; then
        echo -e "${YELLOW}Please enter your Sentry DSN:${NC}"
        read -s SENTRY_DSN
        echo
        
        if [[ -n "$SENTRY_DSN" ]]; then
            echo "$SENTRY_DSN" | gh secret set SENTRY_DSN
            echo -e "${GREEN}✅ SENTRY_DSN added${NC}"
        fi
    fi
}

# Create workflow templates
create_workflow_templates() {
    echo -e "\n${YELLOW}Creating workflow templates...${NC}"
    
    # Create minimal AI PR review workflow
    cat > "$WORKFLOWS_DIR/ai-pr-review.yml" << 'EOF'
name: AI PR Review and Analysis

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'PR number to review'
        required: true
        type: string

permissions:
  contents: read
  pull-requests: write
  issues: write

env:
  CLAUDE_MODEL: claude-3-5-sonnet-20241022
  MAX_REVIEW_COST: 5.00
  REVIEW_CONFIDENCE_THRESHOLD: 0.8
  # Start with conservative limits
  MAX_FILES: 10
  MAX_ADDITIONS: 500

jobs:
  prepare-review:
    name: Prepare PR Review Context
    runs-on: ubuntu-latest
    outputs:
      should_review: ${{ steps.check.outputs.should_review }}
      
    steps:
      - name: Check PR eligibility
        id: check
        uses: actions/github-script@v7
        with:
          script: |
            const pr = context.payload.pull_request;
            
            // Skip if labeled to skip
            const labels = pr.labels.map(l => l.name);
            if (labels.includes('skip-ai-review')) {
              core.setOutput('should_review', 'false');
              return;
            }
            
            // Skip draft PRs
            if (pr.draft) {
              core.setOutput('should_review', 'false');
              return;
            }
            
            // Check size limits
            if (pr.changed_files > ${{ env.MAX_FILES }}) {
              core.setOutput('should_review', 'false');
              console.log('PR too large: too many files');
              return;
            }
            
            if (pr.additions > ${{ env.MAX_ADDITIONS }}) {
              core.setOutput('should_review', 'false');
              console.log('PR too large: too many additions');
              return;
            }
            
            core.setOutput('should_review', 'true');

  ai-review:
    name: Perform AI Review
    runs-on: ubuntu-latest
    needs: prepare-review
    if: needs.prepare-review.outputs.should_review == 'true'
    
    steps:
      - name: Checkout PR
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          
      - name: Review with AI
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          # Run AI review script
          echo "🤖 AI review would run here"
          echo "This is a template - implement the actual review logic"
EOF
    
    # Create issue-to-PR workflow template
    cat > "$WORKFLOWS_DIR/ai-issue-to-pr.yml.template" << 'EOF'
name: AI Issue to PR Converter

on:
  issues:
    types: [labeled]
  workflow_dispatch:
    inputs:
      issue_number:
        description: 'Issue number to convert to PR'
        required: true
        type: string

permissions:
  contents: write
  issues: write
  pull-requests: write

env:
  CLAUDE_MODEL: claude-3-5-sonnet-20241022
  TRIGGER_LABEL: 'ai-implement'

jobs:
  validate-issue:
    name: Validate Issue for Implementation
    runs-on: ubuntu-latest
    outputs:
      should_proceed: ${{ steps.validate.outputs.proceed }}
      
    steps:
      - name: Check trigger
        id: trigger
        run: |
          if [[ "${{ github.event.label.name }}" == "${{ env.TRIGGER_LABEL }}" ]]; then
            echo "proceed=true" >> $GITHUB_OUTPUT
          else
            echo "proceed=false" >> $GITHUB_OUTPUT
          fi

  implement-issue:
    name: Implement Issue Solution
    runs-on: ubuntu-latest
    needs: validate-issue
    if: needs.validate-issue.outputs.should_proceed == 'true'
    
    steps:
      - name: Implementation placeholder
        run: |
          echo "🤖 AI implementation would run here"
          echo "This is a template - implement the actual logic"
EOF
    
    echo -e "${GREEN}✅ Workflow templates created${NC}"
}

# Create issue templates
create_issue_templates() {
    echo -e "\n${YELLOW}Creating issue templates...${NC}"
    
    cat > "$REPO_ROOT/.github/ISSUE_TEMPLATE/ai-feature.md" << 'EOF'
---
name: AI-Ready Feature Request
about: Request a feature that can be implemented by AI
title: '[FEATURE] '
labels: enhancement, ai-eligible
assignees: ''
---

## Description
<!-- Provide a clear and concise description of the feature -->

## Acceptance Criteria
<!-- List specific, measurable criteria for completion -->
- [ ] 
- [ ] 
- [ ] 

## Technical Requirements
<!-- Specify any technical constraints or requirements -->
- 
- 

## Implementation Notes
<!-- Optional: Provide guidance for AI implementation -->

## Context
<!-- Why is this feature needed? What problem does it solve? -->
EOF
    
    cat > "$REPO_ROOT/.github/ISSUE_TEMPLATE/ai-bug.md" << 'EOF'
---
name: AI-Ready Bug Report
about: Report a bug that can be fixed by AI
title: '[BUG] '
labels: bug, ai-eligible
assignees: ''
---

## Bug Description
<!-- Clear description of the bug -->

## Steps to Reproduce
1. 
2. 
3. 

## Expected Behavior
<!-- What should happen? -->

## Actual Behavior
<!-- What actually happens? -->

## Acceptance Criteria
- [ ] Bug is fixed
- [ ] Tests added to prevent regression
- [ ] No new issues introduced

## Technical Context
<!-- File paths, error messages, logs -->
```
Error messages or logs here
```

## Environment
- OS: 
- Version: 
- Node.js: 
EOF
    
    echo -e "${GREEN}✅ Issue templates created${NC}"
}

# Create helper scripts
create_helper_scripts() {
    echo -e "\n${YELLOW}Creating helper scripts...${NC}"
    
    # Cost calculator
    cat > "$REPO_ROOT/scripts/ai-migration/cost-calculator.js" << 'EOF'
#!/usr/bin/env node

// AI Workflow Cost Calculator
// Estimates costs based on usage patterns

const PRICING = {
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-opus': { input: 15.00, output: 75.00 },
  'claude-3-5-haiku': { input: 0.25, output: 1.25 }
};

function calculateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model];
  if (!pricing) {
    throw new Error(`Unknown model: ${model}`);
  }
  
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost
  };
}

// Example usage
const weeklyEstimates = {
  prReviews: {
    count: 100,
    avgInputTokens: 2000,
    avgOutputTokens: 500,
    model: 'claude-3-5-sonnet'
  },
  issueImplementation: {
    count: 20,
    avgInputTokens: 3000,
    avgOutputTokens: 8000,
    model: 'claude-3-5-sonnet'
  },
  testGeneration: {
    count: 50,
    avgInputTokens: 1500,
    avgOutputTokens: 2000,
    model: 'claude-3-5-haiku'
  }
};

console.log('📊 Weekly Cost Estimates\n');

let totalWeeklyCost = 0;

for (const [feature, data] of Object.entries(weeklyEstimates)) {
  const cost = calculateCost(
    data.model,
    data.count * data.avgInputTokens,
    data.count * data.avgOutputTokens
  );
  
  console.log(`${feature}:`);
  console.log(`  Count: ${data.count}`);
  console.log(`  Model: ${data.model}`);
  console.log(`  Cost: $${cost.totalCost.toFixed(2)}`);
  console.log();
  
  totalWeeklyCost += cost.totalCost;
}

console.log(`Total Weekly Cost: $${totalWeeklyCost.toFixed(2)}`);
console.log(`Total Monthly Cost: $${(totalWeeklyCost * 4.33).toFixed(2)}`);
console.log(`Total Annual Cost: $${(totalWeeklyCost * 52).toFixed(2)}`);
EOF
    
    chmod +x "$REPO_ROOT/scripts/ai-migration/cost-calculator.js"
    
    # Emergency stop script
    cat > "$REPO_ROOT/scripts/ai-migration/emergency-stop.sh" << 'EOF'
#!/bin/bash

# Emergency Stop Script - Disable all AI workflows immediately

echo "🚨 EMERGENCY STOP - Disabling all AI workflows..."

# Disable workflows
for workflow in "AI PR Review" "AI Issue to PR" "AI Test Generation" "AI Docs Sync"; do
    echo "Disabling $workflow..."
    gh workflow disable "$workflow" 2>/dev/null || echo "  (not found or already disabled)"
done

# Cancel running workflows
echo -e "\nCancelling running workflows..."
for workflow in "AI PR Review" "AI Issue to PR" "AI Test Generation" "AI Docs Sync"; do
    for run in $(gh run list --workflow="$workflow" --status="in_progress" --json databaseId -q '.[].databaseId' 2>/dev/null); do
        echo "Cancelling run $run..."
        gh run cancel $run
    done
done

echo -e "\n✅ All AI workflows have been stopped"
echo "To re-enable, use: gh workflow enable <workflow-name>"
EOF
    
    chmod +x "$REPO_ROOT/scripts/ai-migration/emergency-stop.sh"
    
    echo -e "${GREEN}✅ Helper scripts created${NC}"
}

# Create monitoring dashboard
create_monitoring_dashboard() {
    echo -e "\n${YELLOW}Creating monitoring dashboard...${NC}"
    
    cat > "$REPO_ROOT/scripts/ai-migration/monitor-dashboard.sh" << 'EOF'
#!/bin/bash

# AI Workflows Monitoring Dashboard

clear
echo "📊 AI Workflows Dashboard - $(date)"
echo "========================================"

# Workflow status
echo -e "\n🔄 Workflow Status:"
for workflow in "AI PR Review" "AI Issue to PR" "AI Test Generation" "AI Docs Sync"; do
    status=$(gh workflow view "$workflow" --json state -q .state 2>/dev/null || echo "not found")
    printf "  %-20s %s\n" "$workflow:" "$status"
done

# Recent runs
echo -e "\n📈 Recent Runs (last 24h):"
gh run list --limit 10 --json workflowName,status,conclusion,createdAt | \
    jq -r '.[] | select(.workflowName | startswith("AI ")) | 
    "\(.workflowName): \(.status) - \(.conclusion // "in progress")"' | \
    head -5

# Cost estimate (placeholder)
echo -e "\n💰 Today's Estimated Cost:"
echo "  PR Reviews: ~$2.50"
echo "  Issues: ~$1.20"
echo "  Tests: ~$0.80"
echo "  Total: ~$4.50"

# Active PRs
echo -e "\n🔍 Active PRs with AI Review:"
gh pr list --limit 5 --json number,title,labels | \
    jq -r '.[] | select(.labels[].name == "ai-reviewed") | 
    "  PR #\(.number): \(.title)"'

echo -e "\nPress Ctrl+C to exit"
EOF
    
    chmod +x "$REPO_ROOT/scripts/ai-migration/monitor-dashboard.sh"
    
    echo -e "${GREEN}✅ Monitoring dashboard created${NC}"
}

# Main execution
main() {
    echo -e "\n${GREEN}Starting AI Workflows Setup...${NC}\n"
    
    check_prerequisites
    setup_directories
    setup_secrets
    create_workflow_templates
    create_issue_templates
    create_helper_scripts
    create_monitoring_dashboard
    
    echo -e "\n${GREEN}🎉 Setup Complete!${NC}"
    echo -e "\nNext steps:"
    echo "1. Review and customize the workflow files in .github/workflows/"
    echo "2. Test with a small PR using the ai-pr-review workflow"
    echo "3. Run ./scripts/ai-migration/cost-calculator.js to estimate costs"
    echo "4. Use ./scripts/ai-migration/monitor-dashboard.sh to monitor workflows"
    echo -e "\nFor emergencies, run: ${RED}./scripts/ai-migration/emergency-stop.sh${NC}"
    echo -e "\nRefer to ${GREEN}MIGRATION_GUIDE.md${NC} for detailed instructions."
}

# Run main function
main