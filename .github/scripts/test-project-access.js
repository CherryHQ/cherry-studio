/**
 * Simple test for CherryHQ project board access
 */

const https = require('https');

// Simple GitHub API request function
function makeGitHubApiRequest(token, path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            port: 443,
            path: path,
            method: method,
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'AutomatSEO-Upstream-Monitor',
                'Accept': method === 'POST' ? 'application/vnd.github.v3+json' : 'application/vnd.github.v3+json'
            }
        };

        if (method === 'POST' && body) {
            options.headers['Content-Type'] = 'application/json';
        }

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ status: res.statusCode, data: jsonData });
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (method === 'POST' && body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

async function testCherryHQProjects() {
    const token = process.env.UPSTREAM_TOKEN;

    if (!token) {
        console.error('❌ Error: UPSTREAM_TOKEN environment variable is required');
        process.exit(1);
    }

    console.log('🔍 Testing CherryHQ Project Board Access\n');
    console.log(`📋 Using token: ${token.substring(0, 10)}...`);

    try {
        // Test 1: Check if we can access CherryHQ organization projects
        console.log('\n1️⃣ Testing CherryHQ organization access...');
        const orgProjects = await makeGitHubApiRequest(token, '/orgs/CherryHQ/projects');
        console.log(`   Status: ${orgProjects.status}`);
        if (orgProjects.status === 200) {
            console.log(`   ✅ Found ${orgProjects.data.length} public projects`);
            orgProjects.data.forEach(project => {
                console.log(`   • ${project.name} (ID: ${project.id})`);
            });
        } else {
            console.log('   ❌ Cannot access organization projects');
            console.log('   Response:', orgProjects.data);
        }

        // Test 2: Try to access specific project boards
        const projectIds = [7, 3]; // Roadmap and Project boards

        for (const projectId of projectIds) {
            console.log(`\n2️⃣ Testing Project ID ${projectId}...`);
            try {
                const project = await makeGitHubApiRequest(token, `/projects/${projectId}`);
                console.log(`   Status: ${project.status}`);
                if (project.status === 200) {
                    console.log(`   ✅ ${project.data.name} - ${project.data.state}`);
                    console.log(`   📝 ${project.data.body || 'No description'}`);
                    console.log(`   🔗 Creator: ${project.data.creator?.login}`);
                    console.log(`   📊 Columns: ${project.data.columns_url}`);
                } else {
                    console.log('   ❌ Cannot access project');
                    console.log('   Response:', project.data);
                }
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
            }
        }

        // Test 3: Try GraphQL approach
        console.log('\n3️⃣ Testing GitHub GraphQL API...');
        const graphqlQuery = {
            query: `
                query {
                    organization(login: "CherryHQ") {
                        projectsV2(first: 10) {
                            nodes {
                                id
                                title
                                public
                                url
                                number
                                closed
                                createdAt
                                updatedAt
                            }
                        }
                    }
                }
            `
        };

        const graphqlData = await makeGitHubApiRequest(token, '/graphql', 'POST', graphqlQuery);
        console.log(`   Status: ${graphqlData.status}`);
        console.log('   Raw response:', JSON.stringify(graphqlData.data, null, 2));

        if (graphqlData.status === 200 && graphqlData.data.data && graphqlData.data.data.organization) {
            const projects = graphqlData.data.data.organization.projectsV2.nodes;
            console.log(`   ✅ Found ${projects.length} projects via GraphQL:`);
            projects.forEach(project => {
                console.log(`   • ${project.title} (${project.public ? 'Public' : 'Private'}) - ${project.url}`);
            });
        } else {
            console.log('   ❌ GraphQL query failed or no data found');
            if (graphqlData.data.errors) {
                console.log('   GraphQL Errors:', graphqlData.data.errors);
            }
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
    }
}

testCherryHQProjects();