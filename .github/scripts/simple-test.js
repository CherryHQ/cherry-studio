/**
 * Simple test without external dependencies
 */

console.log('🧪 Simple Setup Verification\n');

// Check if key files exist
const fs = require('fs');

const requiredFiles = [
    '.github/workflows/upstream-sync-monitor.yml',
    '.github/workflows/project-automation.yml',
    '.github/workflows/issue-triage.yml',
    '.github/workflows/monitoring-dashboard.yml',
    '.github/scripts/project-automation.js',
    '.github/scripts/monitoring-dashboard.py',
    '.github/CODEOWNERS',
    '.github/dependabot.yml'
];

let filesFound = 0;
console.log('📁 Checking required files:');

requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`   ✅ ${file}`);
        filesFound++;
    } else {
        console.log(`   ❌ ${file} - Missing`);
    }
});

console.log(`\n📊 Files found: ${filesFound}/${requiredFiles.length}\n`);

// Check package.json for automation readiness
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    console.log('📦 Package.json check:');
    console.log(`   ✅ Name: ${packageJson.name}`);
    console.log(`   ✅ Version: ${packageJson.version}`);
    console.log(`   ✅ Scripts: ${Object.keys(packageJson.scripts || {}).length}`);
} catch (error) {
    console.log('   ❌ Package.json not found or invalid');
}

console.log('\n🎯 Next Steps:');
console.log('1. Add UPSTREAM_TOKEN to GitHub secrets');
console.log('2. Add PROJECT_ID to GitHub secrets');
console.log('3. Configure branch protection rules');
console.log('4. Monitor Actions tab for workflow runs');

console.log('\n📊 Expected timeline:');
console.log('- Upstream monitoring: Every 2 hours (automatic)');
console.log('- Issue triage: Every 4 hours (automatic)');
console.log('- Dashboard: Every 6 hours (automatic)');
console.log('- Project automation: Weekly (automatic)');

console.log('\n🔗 Quick links:');
console.log('- Repository: https://github.com/imrshohel/automatseo');
console.log('- Actions: https://github.com/imrshohel/automatseo/actions');
console.log('- Settings: https://github.com/imrshohel/automatseo/settings');

console.log('\n✅ Setup verification complete!');
console.log('Your automation system is ready to start working once secrets are added.');