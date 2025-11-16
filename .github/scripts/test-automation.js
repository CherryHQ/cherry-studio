/**
 * Test script for AutomatSEO automation system
 * Run this to verify all workflows are working correctly
 */

const { Octokit } = require('@octokit/rest');

async function testAutomation() {
    console.log('🧪 Testing AutomatSEO Automation System...\n');

    // Configuration
    const owner = 'imrshohel';
    const repo = 'automatseo';
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
        console.error('❌ GITHUB_TOKEN environment variable is required');
        process.exit(1);
    }

    const octokit = new Octokit({ auth: token });

    try {
        // Test 1: Check if workflows exist
        console.log('1️⃣  Checking workflow files...');
        const { data: workflows } = await octokit.rest.actions.listRepoWorkflows({
            owner,
            repo
        });

        const requiredWorkflows = [
            'upstream-sync-monitor.yml',
            'project-automation.yml',
            'issue-triage.yml',
            'monitoring-dashboard.yml',
            'branch-protection.yml'
        ];

        let workflowsFound = 0;
        requiredWorkflows.forEach(workflowName => {
            const exists = workflows.some(w => w.path.endsWith(workflowName));
            if (exists) {
                console.log(`   ✅ ${workflowName}`);
                workflowsFound++;
            } else {
                console.log(`   ❌ ${workflowName} - Missing`);
            }
        });

        console.log(`\n   📊 Workflows: ${workflowsFound}/${requiredWorkflows.length} found\n`);

        // Test 2: Check if project automation scripts exist
        console.log('2️⃣  Checking automation scripts...');
        try {
            const { data: scripts } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: '.github/scripts'
            });

            const requiredScripts = ['project-automation.js', 'monitoring-dashboard.py'];
            let scriptsFound = 0;

            requiredScripts.forEach(scriptName => {
                const exists = scripts.some(s => s.name === scriptName);
                if (exists) {
                    console.log(`   ✅ ${scriptName}`);
                    scriptsFound++;
                } else {
                    console.log(`   ❌ ${scriptName} - Missing`);
                }
            });

            console.log(`\n   📊 Scripts: ${scriptsFound}/${requiredScripts.length} found\n`);
        } catch (error) {
            console.log('   ⚠️  Could not check scripts (may not exist yet)\n');
        }

        // Test 3: Check CODEOWNERS configuration
        console.log('3️⃣  Checking CODEOWNERS...');
        try {
            const { data: codeowners } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: '.github/CODEOWNERS'
            });

            const content = Buffer.from(codeowners.content, 'base64').toString();
            if (content.includes('@imrshohel')) {
                console.log('   ✅ CODEOWNERS configured correctly');
            } else {
                console.log('   ⚠️  CODEOWNERS may need updating');
            }
        } catch (error) {
            console.log('   ❌ CODEOWNERS file not found');
        }

        console.log();

        // Test 4: Check repository configuration
        console.log('4️⃣  Checking repository configuration...');
        const { data: repoData } = await octokit.rest.repos.get({ owner, repo });

        console.log(`   📊 Repository: ${repoData.name}`);
        console.log(`   📊 Default branch: ${repoData.default_branch}`);
        console.log(`   📊 Private: ${repoData.private}`);
        console.log(`   📊 Issues enabled: ${repoData.has_issues}`);
        console.log(`   📊 Projects enabled: ${repoData.has_projects}`);

        console.log();

        // Test 5: Check upstream remote configuration
        console.log('5️⃣  Checking upstream remote...');
        try {
            const { data: forks } = await octokit.rest.repos.listForks({
                owner: 'CherryHQ',
                repo: 'cherry-studio'
            });

            const isForked = forks.some(f => f.owner.login === owner);
            if (isForked) {
                console.log('   ✅ Repository is forked from CherryHQ/cherry-studio');
            } else {
                console.log('   ⚠️  Repository may not be a fork of CherryHQ/cherry-studio');
            }
        } catch (error) {
            console.log('   ❌ Could not check fork status');
        }

        console.log();

        // Test 6: Create test issue to verify workflows
        console.log('6️⃣  Creating test issue...');
        try {
            const { data: testIssue } = await octokit.rest.issues.create({
                owner,
                repo,
                title: '🧪 Test Automation System',
                body: `
# Automation System Test

This is a test issue to verify the automation workflows are working:

- [x] Workflow files uploaded
- [x] Scripts configured
- [x] Repository settings checked
- [ ] Upstream monitoring (will run automatically)
- [ ] Issue triage (should run automatically)
- [ ] Project board integration (if configured)

**Expected behaviors:**
1. This issue should be automatically classified within 4 hours
2. It should get appropriate labels (priority, type, etc.)
3. If project board is configured, it should appear in the project
4. Weekly reports should include this test

*Created by automation test script at ${new Date().toISOString()}*
                `,
                labels: ['test', 'automation-test']
            });

            console.log(`   ✅ Test issue created: #${testIssue.number}`);
            console.log(`   🔗 ${testIssue.html_url}`);
        } catch (error) {
            console.log(`   ❌ Failed to create test issue: ${error.message}`);
        }

        console.log('\n🎉 Automation system test complete!');
        console.log('\n📋 Next steps:');
        console.log('1. Add your GitHub secrets (UPSTREAM_TOKEN, PROJECT_ID)');
        console.log('2. Configure branch protection rules');
        console.log('3. Verify project board integration');
        console.log('4. Monitor workflows in Actions tab');
        console.log('5. Check for automatic issue classification within 4 hours');

        console.log('\n📊 Expected timeline:');
        console.log('- Issue triage: Within 4 hours');
        console.log('- Upstream monitoring: Every 2 hours');
        console.log('- Project automation: Weekly (Mondays)');
        console.log('- Monitoring dashboard: Every 6 hours');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    testAutomation();
}

module.exports = { testAutomation };