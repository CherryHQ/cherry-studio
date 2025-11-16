/**
 * Quick test to verify secrets are working
 */

const { Octokit } = require('@octokit/rest');

async function quickTest() {
    console.log('🧪 Quick Setup Test\n');

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.log('❌ GITHUB_TOKEN not found in environment');
        console.log('💡 Make sure secrets are added to your repository');
        return false;
    }

    const octokit = new Octokit({ auth: token });

    try {
        // Test 1: Can we access your repository
        console.log('1️⃣  Testing repository access...');
        const { data: repo } = await octokit.rest.repos.get({
            owner: 'imrshohel',
            repo: 'automatseo'
        });
        console.log(`   ✅ Repository: ${repo.name}`);
        console.log(`   ✅ Private: ${repo.private}`);
        console.log(`   ✅ Default branch: ${repo.default_branch}`);

        // Test 2: Can we access upstream (CherryHQ/cherry-studio)
        console.log('\n2️⃣  Testing upstream access...');
        try {
            const { data: upstream } = await octokit.rest.repos.get({
                owner: 'CherryHQ',
                repo: 'cherry-studio'
            });
            console.log(`   ✅ Upstream: ${upstream.name}`);
            console.log(`   ✅ Stars: ${upstream.stargazers_count}`);
            console.log(`   ✅ Forks: ${upstream.forks_count}`);
            console.log(`   ✅ Issues: ${upstream.open_issues_count}`);
        } catch (error) {
            console.log(`   ❌ Cannot access upstream: ${error.message}`);
            return false;
        }

        // Test 3: Check recent upstream activity
        console.log('\n3️⃣  Testing upstream activity access...');
        try {
            const { data: issues } = await octokit.rest.issues.listForRepo({
                owner: 'CherryHQ',
                repo: 'cherry-studio',
                state: 'open',
                sort: 'updated',
                direction: 'desc',
                per_page: 5
            });

            console.log(`   ✅ Found ${issues.length} recent issues`);
            console.log('   Recent issues:');
            issues.forEach((issue, index) => {
                console.log(`      ${index + 1}. ${issue.title}`);
            });
        } catch (error) {
            console.log(`   ❌ Cannot list upstream issues: ${error.message}`);
            return false;
        }

        // Test 4: Check if we can create issues in your repository
        console.log('\n4️⃣  Testing issue creation permission...');
        try {
            const { data: testIssue } = await octokit.rest.issues.create({
                owner: 'imrshohel',
                    repo: 'automatseo',
                    title: '🧪 Quick Setup Test',
                    body: 'This is a quick test to verify the automation setup is working correctly. You can delete this issue.',
                    labels: ['test']
                });

            console.log(`   ✅ Test issue created: #${testIssue.number}`);
            console.log(`   🔗 ${testIssue.html_url}`);

            // Close the test issue immediately
            await octokit.rest.issues.update({
                owner: 'imrshohel',
                repo: 'automatseo',
                issue_number: testIssue.number,
                state: 'closed'
            });
            console.log(`   ✅ Test issue closed successfully`);

        } catch (error) {
            console.log(`   ❌ Cannot create issues: ${error.message}`);
            return false;
        }

        console.log('\n🎉 ALL TESTS PASSED!');
        console.log('\n✅ Your setup is ready for automation!');
        console.log('\n📋 What happens next:');
        console.log('   • Upstream monitoring will run every 2 hours');
        console.log('   • Issue triage will classify new issues within 4 hours');
        console.log('   • Dashboard will generate every 6 hours');
        console.log('   • Weekly reports on Mondays at 8 AM UTC');

        return true;

    } catch (error) {
        console.log(`\n❌ Test failed: ${error.message}`);
        return false;
    }
}

if (require.main === module) {
    quickTest().then(success => {
        process.exit(success ? 0 : 1);
    });
}