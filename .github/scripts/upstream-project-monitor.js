/**
 * Upstream Project Board Monitor for AutomatSEO
 * Fetches CherryHQ project board data for enhanced intelligence
 */

const https = require('https');

class UpstreamProjectMonitor {
    constructor(token) {
        this.token = token;
        this.headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'AutomatSEO-ProjectMonitor'
        };
    }

    async fetchGitHubAPI(url) {
        const response = await fetch(url, { headers: this.headers });
        if (!response.ok) {
            throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    async fetchProjectBoard(projectId, projectName) {
        try {
            console.log(`📋 Fetching ${projectName} project board (ID: ${projectId})`);

            // Fetch project details
            const project = await this.fetchGitHubAPI(`https://api.github.com/orgs/CherryHQ/projects/${projectId}`);

            // Fetch columns
            const columns = await this.fetchGitHubAPI(project.columns_url.replace('/projects', '/projects/columns'));

            const boardData = {
                project: {
                    name: project.name,
                    body: project.body,
                    number: project.number,
                    html_url: project.html_url
                },
                columns: [],
                total_cards: 0,
                items_by_status: { open: 0, closed: 0 },
                priority_distribution: {},
                type_distribution: {},
                labels_distribution: {}
            };

            // Fetch cards for each column
            for (const column of columns) {
                const cards = await this.fetchGitHubAPI(column.cards_url);

                const columnData = {
                    id: column.id,
                    name: column.name,
                    cards: [],
                    count: cards.length
                };

                for (const card of cards) {
                    if (card.content && (card.content.type === 'Issue' || card.content.type === 'PullRequest')) {
                        let itemData;

                        if (card.content.type === 'Issue') {
                            // Fetch full issue details
                            const [owner, repo] = card.content.repository.full_name.split('/');
                            itemData = await this.fetchGitHubAPI(`https://api.github.com/repos/${owner}/${repo}/issues/${card.content.number}`);
                        } else {
                            // Fetch PR details
                            const [owner, repo] = card.content.repository.full_name.split('/');
                            itemData = await this.fetchGitHubAPI(`https://api.github.com/repos/${owner}/${repo}/pulls/${card.content.number}`);
                        }

                        const processedCard = {
                            id: card.id,
                            issue_id: itemData.id,
                            number: itemData.number,
                            title: itemData.title,
                            url: itemData.html_url,
                            state: itemData.state,
                            labels: itemData.labels || [],
                            assignees: itemData.assignees || [],
                            milestone: itemData.milestone ? itemData.milestone.title : null,
                            created_at: itemData.created_at,
                            updated_at: itemData.updated_at,
                            type: card.content.type,
                            comments: itemData.comments || 0,
                            reactions: itemData.reactions ? Object.values(itemData.reactions).reduce((sum, count) => sum + count, 0) : 0
                        };

                        columnData.cards.push(processedCard);
                        boardData.total_cards++;

                        // Categorize
                        this.categorizeItem(boardData, processedCard);
                    }
                }

                boardData.columns.push(columnData);
            }

            return boardData;

        } catch (error) {
            console.error(`❌ Error fetching ${projectName}:`, error.message);
            return null;
        }
    }

    categorizeItem(boardData, item) {
        // Status distribution
        const status = item.state === 'open' ? 'open' : 'closed';
        boardData.items_by_status[status] = (boardData.items_by_status[status] || 0) + 1;

        // Priority distribution
        const priorityLabels = (item.labels || []).filter(l =>
            l.name.toLowerCase().includes('priority') ||
            l.name.toLowerCase().includes('critical') ||
            l.name.toLowerCase().includes('urgent')
        );

        if (priorityLabels.length > 0) {
            const priority = priorityLabels[0].name.toLowerCase();
            boardData.priority_distribution[priority] = (boardData.priority_distribution[priority] || 0) + 1;
        }

        // Type distribution
        const typeLabels = (item.labels || []).filter(l =>
            ['bug', 'feature', 'enhancement', 'documentation', 'performance', 'security'].includes(l.name.toLowerCase())
        );

        if (typeLabels.length > 0) {
            const type = typeLabels[0].name.toLowerCase();
            boardData.type_distribution[type] = (boardData.type_distribution[type] || 0) + 1;
        }

        // Labels distribution (all labels)
        (item.labels || []).forEach(label => {
            const labelName = label.name.toLowerCase();
            boardData.labels_distribution[labelName] = (boardData.labels_distribution[labelName] || 0) + 1;
        });
    }

    async fetchBothProjects() {
        console.log('🔍 Fetching CherryHQ Project Boards...\n');

        const [roadmapData, projectData] = await Promise.all([
            this.fetchProjectBoard(7, 'Cherry Studio Roadmap'),
            this.fetchProjectBoard(3, 'Cherry Studio Project')
        ]);

        if (!roadmapData || !projectData) {
            throw new Error('Failed to fetch one or both project boards');
        }

        const analysis = {
            executive_summary: {
                total_upstream_items: roadmapData.total_cards + projectData.total_cards,
                roadmap_items: roadmapData.total_cards,
                project_items: projectData.total_cards,
                completion_rates: {
                    roadmap: this.calculateCompletion(roadmapData),
                    project: this.calculateCompletion(projectData)
                },
                last_updated: new Date().toISOString()
            },

            roadmap_details: {
                project_name: roadmapData.project.name,
                total_items: roadmapData.total_cards,
                completion_rate: this.calculateCompletion(roadmapData),
                columns: roadmapData.columns.map(col => ({
                    name: col.name,
                    count: col.count,
                    items: col.cards.slice(0, 5).map(card => ({
                        title: card.title,
                        number: card.number,
                        state: card.state,
                        url: card.url,
                        priority: this.getPriorityLabel(card.labels),
                        type: this.getTypeLabel(card.labels),
                        assignee: this.getAssignee(card.assignees),
                        created: card.created_at
                    }))
                }))
            },

            project_details: {
                project_name: projectData.project.name,
                total_items: projectData.total_cards,
                completion_rate: this.calculateCompletion(projectData),
                columns: projectData.columns.map(col => ({
                    name: col.name,
                    count: col.count,
                    items: col.cards.slice(0, 5).map(card => ({
                        title: card.title,
                        number: card.number,
                        state: card.state,
                        url: card.url,
                        priority: this.getPriorityLabel(card.labels),
                        type: this.getTypeLabel(card.labels),
                        assignee: this.getAssignee(card.assignees),
                        created: card.created_at
                    }))
                }))
            },

            cross_analysis: {
                priority_distribution: {
                    roadmap: roadmapData.priority_distribution,
                    project: projectData.priority_distribution
                },
                type_distribution: {
                    roadmap: roadmapData.type_distribution,
                    project: projectData.type_distribution
                },
                labels_distribution: {
                    roadmap: roadmapData.labels_distribution,
                    project: projectData.labels_distribution
                },
                insights: this.generateInsights(roadmapData, projectData)
            },

            actionable_items: this.generateActionableItems(roadmapData, projectData)
        };

        return analysis;
    }

    calculateCompletion(projectData) {
        const closedItems = projectData.items_by_status.closed || 0;
        const totalItems = projectData.total_cards;

        return {
            closed: closedItems,
            total: totalItems,
            percentage: totalItems > 0 ? ((closedItems / totalItems) * 100).toFixed(1) : 0,
            status: totalItems === 0 ? 'No items' : closedItems === totalItems ? 'Complete' : 'In Progress'
        };
    }

    getPriorityLabel(labels) {
        const priority = labels.find(l =>
            l.name.toLowerCase().includes('priority') ||
            l.name.toLowerCase().includes('critical') ||
            l.name.toLowerCase().includes('urgent')
        );
        return priority ? priority.name : 'normal';
    }

    getTypeLabel(labels) {
        const type = labels.find(l =>
            ['bug', 'feature', 'enhancement', 'documentation', 'performance', 'security'].includes(l.name.toLowerCase())
        );
        return type ? type.name : 'other';
    }

    getAssignee(assignees) {
        return assignees.length > 0 ? assignees[0].login : null;
    }

    generateInsights(roadmap, project) {
        const insights = [];

        // Executive level insights
        insights.push(`📊 Total Upstream Activity: ${roadmap.total_cards + project.total_cards} items tracked`);
        insights.push(`📋 Roadmap: ${roadmap.total_cards} items (${this.calculateCompletion(roadmap).percentage}% complete)`);
        insights.push(`📝 Project: ${project.total_items} items (${this.calculateCompletion(project).percentage}% complete)`);

        // Type distribution insights
        if (Object.keys(roadmap.type_distribution).length > 0) {
            const roadmapTypes = Object.entries(roadmap.type_distribution)
                .sort(([,a]) => b - a)
                .slice(0, 3)
                .map(([type, count]) => `${type}: ${count}`);
            insights.push(`🎯 Roadmap Focus: ${roadmapTypes.join(', ')}`);
        }

        if (Object.keys(project.type_distribution).length > 0) {
            const projectTypes = Object.entries(project.type_distribution)
                .sort(([,a]) => b - a)
                .slice(0, 3)
                .map(([type, count]) => `${type}: ${count}`);
            insights.push(`📝 Project Focus: ${projectTypes.join(', ')}`);
        }

        // Priority insights
        const highPriorityTotal = (roadmap.priority_distribution['priority/high'] || 0) + (project.priority_distribution['priority/high'] || 0);
        if (highPriorityTotal > 0) {
            insights.push(`🚨 High Priority: ${highPriorityTotal} items need immediate attention`);
        }

        // Recent activity insights
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentRoadmap = roadmap.columns
            .flatMap(col => col.cards)
            .filter(card => new Date(card.created_at) > sevenDaysAgo)
            .length;
        const recentProject = project.columns
            .flatMap(col => col.cards)
            .filter(card => new Date(card.created_at) > sevenDaysAgo)
            .length;

        insights.push(`📈 Recent Activity: ${recentRoadmap + recentProject} items created in last 7 days`);

        // Completion rate insights
        const roadmapRate = parseFloat(this.calculateCompletion(roadmap).percentage);
        const projectRate = parseFloat(this.calculateCompletion(project).percentage);

        if (roadmapRate > 70) {
            insights.push(`✅ Roadmap Progress: ${roadmapRate}% - Good momentum`);
        } else if (roadmapRate < 30) {
            insights.push(`⚠️ Roadmap Progress: ${roadmapRate}% - May need attention`);
        }

        if (projectRate > 70) {
            insights.push(`✅ Project Progress: ${projectRate}% - Good development velocity`);
        } else if (projectRate < 30) {
            insights.push(`⚠️ Project Progress: ${projectRate}% - May need team support`);
        }

        return insights;
    }

    generateActionableItems(roadmap, project) {
        const actionable = [];

        // High priority items
        const highPriorityItems = [
            ...roadmap.columns.flatMap(col => col.cards.filter(card =>
                card.state === 'open' &&
                card.labels.some(l => l.name.toLowerCase().includes('priority'))
            )).slice(0, 3),
            ...project.columns.flatMap(col => col.cards.filter(card =>
                card.state === 'open' &&
                card.labels.some(l => l.name.toLowerCase().includes('priority'))
            )).slice(0, 3)
        ];

        if (highPriorityItems.length > 0) {
            actionable.push({
                type: 'high_priority',
                title: '🚨 High Priority Items',
                description: `${highPriorityItems.length} items marked as high priority requiring immediate attention`,
                items: highPriorityItems.map(item => ({
                    title: item.title,
                    number: item.number,
                    url: item.url,
                    type: item.type
                }))
            });
        }

        // Stale items (items that haven't been updated recently)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const staleItems = [
            ...roadmap.columns.flatMap(col => col.cards.filter(card =>
                card.state === 'open' &&
                new Date(card.updated_at) < thirtyDaysAgo
            )).slice(0, 3),
            ...project.columns.flatMap(col => col.cards.filter(card =>
                card.state === 'open' &&
                new Date(card.updated_at) < thirtyDaysAgo
            )).slice(0, 3)
        ];

        if (staleItems.length > 0) {
            actionable.push({
                type: 'stale_items',
                title: '⏰ Stale Items Need Review',
                description: `${staleItems.length} items not updated in 30+ days`,
                items: staleItems.map(item => ({
                    title: item.title,
                    number: item.number,
                    url: item.url,
                    last_updated: item.updated_at
                }))
            });
        }

        // Bottleneck columns
        const backlogColumns = project.columns.filter(col =>
            col.name.toLowerCase().includes('backlog') ||
            col.name.toLowerCase().includes('todo')
        ).sort((a, b) => b.count - a.count).slice(0, 2);

        if (backlogColumns.length > 0) {
            actionable.push({
                type: 'bottlenecks',
                title: '📋 Project Bottlenecks',
                description: 'Columns with many items that may need attention',
                columns: backlogColumns.map(col => ({
                    name: col.name,
                    count: col.count
                }))
            });
        }

        return actionable;
    }

    async generateMarkdownReport(data) {
        const report = `# 📊 Upstream CherryHQ Project Board Analysis

*Generated: ${new Date().toISOString()}*
*Monitoring Period: Real-time data from CherryHQ organizations*

## 📋 Executive Summary

| Metric | Roadmap | Project | Total |
|--------|----------|--------|-------|
| Total Items | ${data.roadmap_details.total_items} | ${data.project_details.total_items} | ${data.executive_summary.total_upstream_items} |
| Completion Rate | ${data.executive_summary.completion_rates.roadmap.percentage}% | ${data.executive_summary.completion_rates.project.percentage}% | N/A |
| Last Updated | ${new Date(data.executive_summary.last_updated).toLocaleString()} | ${new Date(data.executive_summary.last_updated).toLocaleString()} | ${new Date(data.executive_summary.last_updated).toLocaleString()} |

## 🎯 Key Insights

${data.cross_analysis.insights.map(insight => `- ${insight}`).join('\n')}

## 📋 Cherry Studio Roadmap Details

**Project:** ${data.roadmap_details.project_name}
- **Total Items:** ${data.roadmap_details.total_items}
- **Completion Rate:** ${data.roadmap_details.completion_rate.percentage}% (${data.roadmap_details.completion_rate.status})
- **Columns:** ${data.roadmap_details.columns.length}

### 📊 Columns Overview

${data.roadmap_details.columns.map(col => `
#### ${col.name} (${col.count} items)
${col.items.slice(0, 3).map(item => `- [#${item.number}](${item.url}) ${item.title}`).join('\n')}
${col.count > 3 ? `- ... and ${col.count - 3} more items` : ''}
`).join('\n')}

## 📝 Cherry Studio Project Details

**Project:** ${data.project_details.project_name}
- **Total Items:** ${data.project_details.total_items}
- **Completion Rate:** ${data.project_details.completion_rate.percentage}% (${data.project_details.completion_rate.status})
- **Columns:** ${data.project_details.columns.length}

### 📊 Columns Overview

${data.project_details.columns.map(col => `
#### ${col.name} (${col.count} items)
${col.items.slice(0, 3).map(item => `- [#${item.number}](${item.url}) ${item.title}`).join('\n')}
${col.count > 3 ? `- ... and ${col.count - 3} more items` : ''}
`).join('\n')}

## 🔍 Cross-Analysis

### 📈 Priority Distribution

| Priority | Roadmap | Project |
|----------|----------|--------|
${Object.entries(data.cross_analysis.priority_distribution.roadmap).map(([priority, count]) => `| ${priority} | ${count} | ${data.cross_analysis.priority_distribution.project[priority] || 0} |`).join('\n')}

### 📊 Type Distribution

| Type | Roadmap | Project |
|------|----------|--------|
${Object.entries(data.cross_analysis.type_distribution.roadmap).map(([type, count]) => `| ${type} | ${count} | ${data.cross_analysis.type_distribution.project[type] || 0} |`).join('\n')}

## 🚨 Actionable Items

${data.actionable_items.map(section => `
### ${section.title}
${section.description}

${section.items.map(item => `- [#${item.number}](${item.url}) ${item.title}${item.last_updated ? ` (Updated: ${new Date(item.last_updated).toLocaleDateString()})` : ''}`).join('\n')}
`).join('\n\n')}

## 📋 Project Board Links

- **Cherry Studio Roadmap:** https://github.com/orgs/CherryHQ/projects/7
- **Cherry Studio Project:** https://github.com/orgs/CherryHQ/projects/3

---

*Report automatically generated by AutomatSEO upstream monitoring system*
*Next update: ${new Date(Date.now() + 2 * 60 * 60 * 1000).toLocaleString()}*
`;

        return report;
    }
}

// If run directly
if (require.main === module) {
    const token = process.env.GITHUB_TOKEN || process.env.UPSTREAM_TOKEN;

    if (!token) {
        console.log('❌ Error: GITHUB_TOKEN or UPSTREAM_TOKEN environment variable is required');
        process.exit(1);
    }

    const monitor = new UpstreamProjectMonitor(token);

    console.log('🔍 Starting Upstream Project Board Monitoring...\n');

    monitor.generateMarkdownReport()
        .then(report => {
            // Save to file
            const fs = require('fs');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `upstream-project-report-${timestamp}.md`;

            fs.writeFileSync(filename, report, 'utf8');

            console.log(`\n✅ Report saved to: ${filename}`);
            console.log(`📊 Report contains: ${report.length} characters`);
            console.log('\n🎯 Key Summary:');
            console.log(`   • Total upstream items: ${report.includes('total_upstream_items') ? report.match(/Total Items.*\| (.*) \|/)?.[1] : 'N/A'}`);
            console.log(`   • Project integration: Ready for automation`);
        })
        .catch(error => {
            console.error('❌ Error:', error.message);
            process.exit(1);
        });
}

module.exports = { UpstreamProjectMonitor };