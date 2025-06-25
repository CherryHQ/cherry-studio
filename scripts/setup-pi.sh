#!/bin/bash

# Perfect Information (PI) Setup Script
# This script sets up the PI enforcement system for local development

echo "🚀 Setting up Perfect Information (PI) enforcement system..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js first.${NC}"
    exit 1
fi

# Check if yarn is installed
if ! command -v yarn &> /dev/null; then
    echo -e "${RED}❌ Yarn is not installed. Please install Yarn first.${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Installing required dependencies...${NC}"

# Install glob package if not already installed
if ! grep -q '"glob"' package.json; then
    echo "Installing glob package..."
    yarn add --dev glob
else
    echo "✓ glob package already installed"
fi

# Make pi-checker.js executable
chmod +x scripts/pi-checker.js
echo "✓ Made pi-checker.js executable"

# Create git pre-commit hook
echo -e "${YELLOW}🔗 Setting up git pre-commit hook...${NC}"

HOOK_FILE=".git/hooks/pre-commit"
if [ -f "$HOOK_FILE" ]; then
    echo -e "${YELLOW}⚠️  Pre-commit hook already exists. Backing up to ${HOOK_FILE}.backup${NC}"
    cp "$HOOK_FILE" "${HOOK_FILE}.backup"
fi

cat > "$HOOK_FILE" << 'EOF'
#!/bin/sh
# Perfect Information pre-commit hook

# Only check staged TypeScript/JavaScript files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$' | tr '\n' ',')

if [ -n "$STAGED_FILES" ]; then
    echo "🔍 Running Perfect Information checks on staged files..."
    node scripts/pi-checker.js --files "$STAGED_FILES"
    
    if [ $? -ne 0 ]; then
        echo ""
        echo "❌ PI checks failed. Please fix the issues before committing."
        echo "💡 Run 'node scripts/pi-checker.js --fix' to auto-fix some issues."
        exit 1
    fi
fi
EOF

chmod +x "$HOOK_FILE"
echo "✓ Git pre-commit hook installed"

# Run initial PI check
echo -e "${YELLOW}🔍 Running initial PI check...${NC}"
node scripts/pi-checker.js --verbose

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Perfect Information system setup complete!${NC}"
    echo ""
    echo "You can now:"
    echo "  • Run 'node scripts/pi-checker.js' to check the entire codebase"
    echo "  • Run 'node scripts/pi-checker.js --fix' to auto-fix issues"
    echo "  • Commit normally - PI checks will run automatically"
    echo ""
    echo "For more information, see:"
    echo "  • .github/pi-standards.md - Full documentation"
    echo "  • .claude/commands/verify-pi.md - Claude command reference"
else
    echo -e "${YELLOW}⚠️  PI setup complete, but there are existing violations.${NC}"
    echo "Run 'node scripts/pi-checker.js --fix' to fix auto-fixable issues."
fi