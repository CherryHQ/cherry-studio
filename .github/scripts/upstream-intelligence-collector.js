/**
 * Upstream Intelligence Collector for AutomatSEO
 *
 * Collects intelligence from CherryHQ public resources without requiring special permissions
 * Focuses on issues, PRs, releases, and basic project board information
 */

const https = require('https');

class UpstreamIntelligenceCollector {
    constructor(token) {
        this.token = token;
        this.upstreamOwner = 'CherryHQ';
        this.upstreamRepo = 'cherry-studio';
        this.upstreamUrl = 'https://github.com/CherryHQ/cherry-studio';
        this.baseUrl = 'https://api.github.com';
    }

    // Simple HTTPS request function
    makeRequest(path) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'Authorization': `token ${this.token}`,
                    'User-Agent': 'AutomatSEO-Intelligence-Collector',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };

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
            req.setTimeout(15000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    // Get repository overview
    async getRepositoryOverview() {
        try {
            console.log('📊 Collecting repository overview...');
            const response = await this.makeRequest(`/repos/${this.upstreamOwner}/${this.upstreamRepo}`);

            if (response.status !== 200) {
                throw new Error(`Failed to fetch repository: ${response.status}`);
            }

            const repo = response.data;
            return {
                name: repo.name,
                description: repo.description,
                stars: repo.stargazers_count,
                forks: repo.forks_count,
                openIssues: repo.open_issues_count,
                language: repo.language,
                updatedAt: repo.updated_at,
                defaultBranch: repo.default_branch,
                isArchived: repo.archived,
                license: repo.license?.name || 'No license'
            };
        } catch (error) {
            console.error('❌ Error fetching repository overview:', error.message);
            return null;
        }
    }

    // Get recent issues with intelligent classification
    async getRecentIssues() {
        try {
            console.log('🐛 Collecting recent issues...');
            const response = await this.makeRequest(`/repos/${this.upstreamOwner}/${this.upstreamRepo}/issues?state=open&sort=updated&direction=desc&per_page=20`);

            if (response.status !== 200) {
                throw new Error(`Failed to fetch issues: ${response.status}`);
            }

            const issues = response.data.filter(issue => !issue.pull_request);

            return issues.map(issue => ({
                number: issue.number,
                title: issue.title,
                state: issue.state,
                createdAt: issue.created_at,
                updatedAt: issue.updated_at,
                author: issue.user.login,
                labels: issue.labels.map(label => label.name),
                assignees: issue.assignees.map(assignee => assignee.login),
                milestone: issue.milestone?.title,
                comments: issue.comments,
                reactions: issue.reactions?.total_count || 0,
                classification: this.classifyIssue(issue),
                priority: this.estimatePriority(issue)
            }));
        } catch (error) {
            console.error('❌ Error fetching issues:', error.message);
            return [];
        }
    }

    // Get recent pull requests
    async getRecentPullRequests() {
        try {
            console.log('🔄 Collecting recent pull requests...');
            const response = await this.makeRequest(`/repos/${this.upstreamOwner}/${this.upstreamRepo}/pulls?state=all&sort=updated&direction=desc&per_page=15`);

            if (response.status !== 200) {
                throw new Error(`Failed to fetch pull requests: ${response.status}`);
            }

            return response.data.map(pr => ({
                number: pr.number,
                title: pr.title,
                state: pr.state,
                createdAt: pr.created_at,
                updatedAt: pr.updated_at,
                author: pr.user.login,
                labels: pr.labels.map(label => label.name),
                mergeable: pr.mergeable,
                additions: pr.additions,
                deletions: pr.deletions,
                changedFiles: pr.changed_files,
                comments: pr.comments,
                reviewComments: pr.review_comments || 0,
                classification: this.classifyPullRequest(pr)
            }));
        } catch (error) {
            console.error('❌ Error fetching pull requests:', error.message);
            return [];
        }
    }

    // Get recent releases
    async getRecentReleases() {
        try {
            console.log('📦 Collecting recent releases...');
            const response = await this.makeRequest(`/repos/${this.upstreamOwner}/${this.upstreamRepo}/releases?per_page=10`);

            if (response.status !== 200) {
                throw new Error(`Failed to fetch releases: ${response.status}`);
            }

            return response.data.map(release => ({
                tagName: release.tag_name,
                name: release.name,
                publishedAt: release.published_at,
                author: release.author.login,
                prerelease: release.prerelease,
                draft: release.draft,
                assets: release.assets.length,
                body: release.body?.substring(0, 200) + '...' || 'No description'
            }));
        } catch (error) {
            console.error('❌ Error fetching releases:', error.message);
            return [];
        }
    }

    // Get contributors information
    async getContributors() {
        try {
            console.log('👥 Collecting contributor information...');
            const response = await this.makeRequest(`/repos/${this.upstreamOwner}/${this.upstreamRepo}/contributors?per_page=30`);

            if (response.status !== 200) {
                throw new Error(`Failed to fetch contributors: ${response.status}`);
            }

            return response.data.map(contributor => ({
                login: contributor.login,
                contributions: contributor.contributions,
                type: contributor.type
            }));
        } catch (error) {
            console.error('❌ Error fetching contributors:', error.message);
            return [];
        }
    }

    // Intelligent issue classification
    classifyIssue(issue) {
        const title = issue.title.toLowerCase();
        const body = issue.body?.toLowerCase() || '';
        const labels = issue.labels.map(label => label.name.toLowerCase());

        const text = `${title} ${body} ${labels.join(' ')}`;

        // Bug classification
        if (text.includes('bug') || text.includes('crash') || text.includes('error') ||
            text.includes('fix') || text.includes('issue') || text.includes('broken')) {
            return 'bug';
        }

        // Feature classification
        if (text.includes('feature') || text.includes('enhancement') || text.includes('add') ||
            text.includes('implement') || text.includes('new') || text.includes('support')) {
            return 'feature';
        }

        // Documentation classification
        if (text.includes('doc') || text.includes('readme') || text.includes('guide') ||
            text.includes('help') || text.includes('tutorial')) {
            return 'documentation';
        }

        // Performance classification
        if (text.includes('performance') || text.includes('slow') || text.includes('optimize') ||
            text.includes('memory') || text.includes('speed')) {
            return 'performance';
        }

        // UI/UX classification
        if (text.includes('ui') || text.includes('ux') || text.includes('interface') ||
            text.includes('design') || text.includes('layout') || text.includes('visual')) {
            return 'ui-ux';
        }

        // Security classification
        if (text.includes('security') || text.includes('vulnerability') || text.includes('auth') ||
            text.includes('permission') || text.includes('safety')) {
            return 'security';
        }

        return 'other';
    }

    // Priority estimation
    estimatePriority(issue) {
        let priority = 1;

        // High priority indicators
        if (issue.labels.some(label =>
            label.name.toLowerCase().includes('critical') ||
            label.name.toLowerCase().includes('high') ||
            label.name.toLowerCase().includes('urgent')
        )) {
            priority += 3;
        }

        // Bug reports get higher priority
        if (this.classifyIssue(issue) === 'bug') {
            priority += 2;
        }

        // Recent activity indicates importance
        const daysSinceUpdate = (Date.now() - new Date(issue.updated_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate < 7) {
            priority += 1;
        }

        // Comments indicate community interest
        if (issue.comments > 5) {
            priority += 1;
        }

        // Reactions indicate importance
        if (issue.reactions?.total_count > 3) {
            priority += 1;
        }

        return Math.min(priority, 5); // Cap at 5
    }

    // Pull request classification
    classifyPullRequest(pr) {
        const title = pr.title.toLowerCase();
        const body = pr.body?.toLowerCase() || '';
        const labels = pr.labels.map(label => label.name.toLowerCase());

        const text = `${title} ${body} ${labels.join(' ')}`;

        if (text.includes('fix') || text.includes('bug') || text.includes('patch')) {
            return 'bugfix';
        }

        if (text.includes('feature') || text.includes('enhancement') || text.includes('implement')) {
            return 'feature';
        }

        if (text.includes('refactor') || text.includes('cleanup') || text.includes('improve')) {
            return 'refactor';
        }

        if (text.includes('test') || text.includes('spec') || text.includes('testing')) {
            return 'test';
        }

        if (text.includes('doc') || text.includes('readme') || text.includes('documentation')) {
            return 'documentation';
        }

        return 'other';
    }

    // Generate comprehensive intelligence report
    async generateIntelligenceReport() {
        console.log('🔍 Collecting upstream intelligence...\n');

        const [overview, issues, pullRequests, releases, contributors] = await Promise.all([
            this.getRepositoryOverview(),
            this.getRecentIssues(),
            this.getRecentPullRequests(),
            this.getRecentReleases(),
            this.getContributors()
        ]);

        // Generate analysis
        const analysis = this.analyzeData({ issues, pullRequests, releases, contributors });

        return {
            timestamp: new Date().toISOString(),
            upstream: this.upstreamUrl,
            overview,
            issues,
            pullRequests,
            releases,
            contributors,
            analysis,
            recommendations: this.generateRecommendations(analysis)
        };
    }

    // Analyze collected data
    analyzeData(data) {
        const { issues, pullRequests, releases, contributors } = data;

        // Issue analysis
        const issueStats = {
            total: issues.length,
            byClassification: {},
            byPriority: {},
            recentActivity: issues.filter(issue => {
                const daysSinceUpdate = (Date.now() - new Date(issue.updated_at).getTime()) / (1000 * 60 * 60 * 24);
                return daysSinceUpdate < 7;
            }).length
        };

        issues.forEach(issue => {
            issueStats.byClassification[issue.classification] = (issueStats.byClassification[issue.classification] || 0) + 1;
            issueStats.byPriority[issue.priority] = (issueStats.byPriority[issue.priority] || 0) + 1;
        });

        // PR analysis
        const prStats = {
            total: pullRequests.length,
            open: pullRequests.filter(pr => pr.state === 'open').length,
            merged: pullRequests.filter(pr => pr.state === 'closed' && pr.mergeable).length,
            byClassification: {},
            avgSize: pullRequests.reduce((sum, pr) => sum + pr.changedFiles, 0) / (pullRequests.length || 1)
        };

        pullRequests.forEach(pr => {
            prStats.byClassification[pr.classification] = (prStats.byClassification[pr.classification] || 0) + 1;
        });

        // Release analysis
        const releaseStats = {
            total: releases.length,
            thisYear: releases.filter(r => new Date(r.publishedAt).getFullYear() === new Date().getFullYear()).length,
            latest: releases[0]?.publishedAt || null
        };

        return {
            issues: issueStats,
            pullRequests: prStats,
            releases: releaseStats,
            contributors: {
                total: contributors.length,
                topContributors: contributors.slice(0, 10)
            }
        };
    }

    // Generate actionable recommendations
    generateRecommendations(analysis) {
        const recommendations = [];

        // Issue-based recommendations
        if (analysis.issues.byClassification.bug > 5) {
            recommendations.push({
                type: 'quality',
                priority: 'high',
                title: 'Focus on Bug Resolution',
                description: `High number of open bugs (${analysis.issues.byClassification.bug}). Consider dedicating resources to bug fixes.`
            });
        }

        if (analysis.issues.recentActivity > 10) {
            recommendations.push({
                type: 'engagement',
                priority: 'medium',
                title: 'High Community Activity',
                description: 'Very active issue discussions. Consider engaging more with the community.'
            });
        }

        // PR-based recommendations
        if (analysis.pullRequests.open > 5) {
            recommendations.push({
                type: 'maintenance',
                priority: 'high',
                title: 'Review Pending Pull Requests',
                description: `${analysis.pullRequests.open} open PRs need review. Consider establishing a review process.`
            });
        }

        // Release-based recommendations
        if (!analysis.releases.latest || (Date.now() - new Date(analysis.releases.latest).getTime()) > (1000 * 60 * 60 * 24 * 60)) {
            recommendations.push({
                type: 'release',
                priority: 'medium',
                title: 'Consider New Release',
                description: 'No recent releases. Consider packaging recent improvements into a new release.'
            });
        }

        return recommendations;
    }

    // Generate markdown report
    async generateMarkdownReport() {
        const report = await this.generateIntelligenceReport();

        const markdown = `# 🚀 CherryHQ Upstream Intelligence Report

**Generated:** ${new Date(report.timestamp).toLocaleString()}
**Source:** ${report.upstream}

---

## 📊 Repository Overview

${report.overview ? `
- **⭐ Stars:** ${report.overview.stars.toLocaleString()}
- **🍴 Forks:** ${report.overview.forks.toLocaleString()}
- **🐛 Open Issues:** ${report.overview.openIssues}
- **💻 Main Language:** ${report.overview.language}
- **📜 License:** ${report.overview.license}
- **🔄 Last Updated:** ${new Date(report.overview.updatedAt).toLocaleDateString()}
` : '❌ Unable to fetch repository overview'}

---

## 🐛 Recent Issues Analysis

**Total Open Issues:** ${report.analysis.issues.total}

### Issues by Classification
${Object.entries(report.analysis.issues.byClassification)
    .map(([type, count]) => `- **${type}:** ${count}`)
    .join('\n')}

### Issues by Priority
${Object.entries(report.analysis.issues.byPriority)
    .sort(([a], [b]) => b - a)
    .map(([priority, count]) => `- **Priority ${priority}:** ${count}`)
    .join('\n')}

### High Priority Issues
${report.issues
    .filter(issue => issue.priority >= 4)
    .slice(0, 5)
    .map(issue => `- [${issue.number}](${issue.upstreamUrl}/issues/${issue.number}) ${issue.title} (${issue.classification})`)
    .join('\n') || 'No high priority issues found'}

---

## 🔄 Pull Requests Analysis

**Total PRs:** ${report.analysis.pullRequests.total}
**Open:** ${report.analysis.pullRequests.open} | **Merged:** ${report.analysis.pullRequests.merged}

### PRs by Type
${Object.entries(report.analysis.pullRequests.byClassification)
    .map(([type, count]) => `- **${type}:** ${count}`)
    .join('\n')}

### Recent Open PRs
${report.pullRequests
    .filter(pr => pr.state === 'open')
    .slice(0, 5)
    .map(pr => `- [${pr.number}](${report.upstreamUrl}/pull/${pr.number}) ${pr.title} (${pr.classification})`)
    .join('\n') || 'No open PRs'}

---

## 📦 Recent Releases

**Total Releases:** ${report.analysis.releases.total}
**This Year:** ${report.analysis.releases.thisYear}

### Latest 3 Releases
${report.releases
    .slice(0, 3)
    .map(release => `- **${release.tagName}** - ${new Date(release.publishedAt).toLocaleDateString()}\n  ${release.body}`)
    .join('\n\n') || 'No releases found'}

---

## 🎯 Actionable Recommendations

${report.recommendations
    .map(rec => `### ${rec.title} (${rec.priority})
**Type:** ${rec.type}
**Description:** ${rec.description}`)
    .join('\n\n') || 'No specific recommendations at this time'}

---

## 📈 Key Metrics

- **Community Engagement:** ${report.analysis.issues.recentActivity} recently active issues
- **Average PR Size:** ${Math.round(report.analysis.pullRequests.avgSize)} files changed
- **Active Contributors:** ${report.analysis.contributors.total}

---

*This report is generated automatically by the AutomatSEO upstream intelligence collector.*
`;

        return {
            markdown,
            report
        };
    }
}

// Main execution
async function main() {
    const token = process.env.UPSTREAM_TOKEN || process.env.GITHUB_TOKEN;

    if (!token) {
        console.error('❌ Error: UPSTREAM_TOKEN or GITHUB_TOKEN environment variable is required');
        process.exit(1);
    }

    const collector = new UpstreamIntelligenceCollector(token);

    try {
        const { markdown, report } = await collector.generateMarkdownReport();

        console.log('\n✅ Upstream Intelligence Collection Complete!\n');
        console.log('📋 Generated Report:');
        console.log(markdown);

        // Save report to file
        const fs = require('fs');
        const filename = `upstream-intelligence-${new Date().toISOString().split('T')[0]}.md`;
        fs.writeFileSync(filename, markdown);
        console.log(`\n💾 Report saved to: ${filename}`);

    } catch (error) {
        console.error('\n❌ Error generating intelligence report:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = UpstreamIntelligenceCollector;