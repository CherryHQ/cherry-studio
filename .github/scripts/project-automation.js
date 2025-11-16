/**
 * GitHub Project Automation for AutomatSEO
 *
 * This script automates task creation, management, and workflow integration
 * with GitHub Projects for upstream activity tracking
 */

const { Octokit } = require('@octokit/rest');
const core = require('@actions/core');

class ProjectAutomation {
  constructor(token, owner, repo) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
    this.projectId = null;
    this.projectFields = {};
  }

  async initialize() {
    try {
      // Get or create project
      await this.getOrCreateProject();
      // Initialize project fields
      await this.initializeProjectFields();
      console.log('Project automation initialized successfully');
    } catch (error) {
      console.error('Failed to initialize project automation:', error);
      throw error;
    }
  }

  async getOrCreateProject() {
    try {
      // Try to find existing project
      const projects = await this.octokit.rest.projects.listForRepo({
        owner: this.owner,
        repo: this.repo,
      });

      const existingProject = projects.data.find(p => p.name === 'AutomatSEO Roadmap');

      if (existingProject) {
        this.projectId = existingProject.id;
        console.log(`Found existing project: ${existingProject.name}`);
        return existingProject;
      }

      // Create new project if not found
      const newProject = await this.octokit.rest.projects.createForRepo({
        owner: this.owner,
        repo: this.repo,
        name: 'AutomatSEO Roadmap',
        body: 'Project roadmap and task management for AutomatSEO development'
      });

      this.projectId = newProject.data.id;
      console.log(`Created new project: ${newProject.data.name}`);

      // Wait a moment for project creation
      await new Promise(resolve => setTimeout(resolve, 2000));

      return newProject.data;

    } catch (error) {
      console.error('Error getting/creating project:', error);
      throw error;
    }
  }

  async initializeProjectFields() {
    try {
      const columns = await this.octokit.rest.projects.listColumns({
        project_id: this.projectId
      });

      // Check if we have the standard columns
      const standardColumns = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Done'];
      const existingColumnNames = columns.data.map(c => c.name);

      for (const columnName of standardColumns) {
        if (!existingColumnNames.includes(columnName)) {
          await this.octokit.rest.projects.createColumn({
            project_id: this.projectId,
            name: columnName
          });
          console.log(`Created column: ${columnName}`);
        }
      }

      // Store column IDs for later use
      this.columns = {};
      const updatedColumns = await this.octokit.rest.projects.listColumns({
        project_id: this.projectId
      });

      updatedColumns.data.forEach(column => {
        this.columns[column.name] = column.id;
      });

      console.log('Project columns initialized:', Object.keys(this.columns));

    } catch (error) {
      console.error('Error initializing project fields:', error);
      throw error;
    }
  }

  async addIssueToProject(issueNumber, columnName = 'Backlog', priority = 'medium') {
    try {
      if (!this.projectId || !this.columns[columnName]) {
        throw new Error('Project not properly initialized');
      }

      // Create project card
      const card = await this.octokit.rest.projects.createCard({
        column_id: this.columns[columnName],
        content_id: issueNumber,
        content_type: 'Issue'
      });

      console.log(`Added issue #${issueNumber} to project column: ${columnName}`);

      // Add priority label if not exists
      await this.addPriorityLabel(issueNumber, priority);

      return card.data;

    } catch (error) {
      console.error(`Error adding issue #${issueNumber} to project:`, error);
      throw error;
    }
  }

  async addPriorityLabel(issueNumber, priority) {
    try {
      const priorityLabels = {
        'low': 'priority/low',
        'medium': 'priority/medium',
        'high': 'priority/high',
        'critical': 'priority/critical'
      };

      const label = priorityLabels[priority] || 'priority/medium';

      await this.octokit.rest.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels: [label]
      });

      console.log(`Added priority label: ${label} to issue #${issueNumber}`);

    } catch (error) {
      console.error(`Error adding priority label to issue #${issueNumber}:`, error);
    }
  }

  async classifyAndAddIssue(issueData) {
    try {
      const classification = this.classifyIssue(issueData);
      const priority = this.determinePriority(issueData);

      // Add labels
      await this.octokit.rest.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueData.number,
        labels: [...classification.labels, `priority/${priority}`]
      });

      // Add to appropriate project column
      const columnName = this.getColumnForType(classification.type);
      await this.addIssueToProject(issueData.number, columnName, priority);

      console.log(`Processed issue #${issueData.number}: ${classification.type} (priority: ${priority})`);

      return {
        classification,
        priority,
        column: columnName
      };

    } catch (error) {
      console.error(`Error classifying and adding issue #${issueData.number}:`, error);
      throw error;
    }
  }

  classifyIssue(issueData) {
    const title = issueData.title.toLowerCase();
    const body = issueData.body ? issueData.body.toLowerCase() : '';
    const text = `${title} ${body}`;
    const existingLabels = issueData.labels.map(l => l.name.toLowerCase());

    // Classification rules
    if (existingLabels.includes('bug') || text.includes('bug') || text.includes('error') || text.includes('crash')) {
      return {
        type: 'bug',
        labels: ['bug', 'upstream-bug'],
        description: 'Bug fix required'
      };
    }

    if (existingLabels.includes('enhancement') || text.includes('feature') || text.includes('add new')) {
      return {
        type: 'feature',
        labels: ['enhancement', 'upstream-feature'],
        description: 'New feature implementation'
      };
    }

    if (text.includes('documentation') || text.includes('docs') || text.includes('readme')) {
      return {
        type: 'documentation',
        labels: ['documentation'],
        description: 'Documentation update required'
      };
    }

    if (text.includes('performance') || text.includes('optimization') || text.includes('speed')) {
      return {
        type: 'performance',
        labels: ['performance'],
        description: 'Performance optimization'
      };
    }

    if (text.includes('security') || text.includes('vulnerability')) {
      return {
        type: 'security',
        labels: ['security'],
        description: 'Security-related update'
      };
    }

    if (text.includes('refactor') || text.includes('cleanup') || text.includes('technical debt')) {
      return {
        type: 'refactor',
        labels: ['refactoring'],
        description: 'Code refactoring required'
      };
    }

    return {
      type: 'review',
      labels: ['upstream-review'],
      description: 'Needs review and assessment'
    };
  }

  determinePriority(issueData) {
    const title = issueData.title.toLowerCase();
    const body = issueData.body ? issueData.body.toLowerCase() : '';
    const text = `${title} ${body}`;
    const labels = issueData.labels.map(l => l.name.toLowerCase());

    // Critical priority
    if (labels.includes('critical') || labels.includes('security') || text.includes('security vulnerability')) {
      return 'critical';
    }

    // High priority
    if (labels.includes('high') || text.includes('urgent') || text.includes('breaking change')) {
      return 'high';
    }

    // Medium priority
    if (labels.includes('enhancement') || labels.includes('feature') || text.includes('new feature')) {
      return 'medium';
    }

    // Low priority
    if (labels.includes('low') || text.includes('minor') || text.includes('cosmetic')) {
      return 'low';
    }

    // Default to medium
    return 'medium';
  }

  getColumnForType(issueType) {
    const columnMapping = {
      'bug': 'To Do',
      'feature': 'Backlog',
      'documentation': 'Backlog',
      'performance': 'To Do',
      'security': 'To Do',
      'refactor': 'Backlog',
      'review': 'Backlog'
    };

    return columnMapping[issueType] || 'Backlog';
  }

  async moveIssue(issueNumber, fromColumn, toColumn) {
    try {
      // Get cards in source column
      const cards = await this.octokit.rest.projects.listCards({
        column_id: this.columns[fromColumn]
      });

      // Find the card for this issue
      const targetCard = cards.data.find(card =>
        card.content && card.content.id === issueNumber
      );

      if (!targetCard) {
        throw new Error(`Card for issue #${issueNumber} not found in column ${fromColumn}`);
      }

      // Move the card
      await this.octokit.rest.projects.moveCard({
        card_id: targetCard.id,
        position: 'top',
        column_id: this.columns[toColumn]
      });

      console.log(`Moved issue #${issueNumber} from ${fromColumn} to ${toColumn}`);

    } catch (error) {
      console.error(`Error moving issue #${issueNumber}:`, error);
      throw error;
    }
  }

  async createReleasePlan(version, releaseDate = null) {
    try {
      const releaseTitle = `Release ${version}`;
      const today = new Date().toISOString().split('T')[0];
      const targetDate = releaseDate || today;

      // Create release planning issue
      const { data: releaseIssue } = await this.octokit.rest.issues.create({
        owner: this.owner,
        repo: this.repo,
        title: `🚀 Release Planning: ${version}`,
        body: this.generateReleasePlanBody(version, targetDate),
        labels: ['release', 'planning', `release-${version}`]
      });

      // Add to In Progress column
      await this.addIssueToProject(releaseIssue.number, 'In Progress', 'high');

      console.log(`Created release plan for version ${version}: ${releaseIssue.html_url}`);
      return releaseIssue;

    } catch (error) {
      console.error(`Error creating release plan for ${version}:`, error);
      throw error;
    }
  }

  generateReleasePlanBody(version, targetDate) {
    return `# 🚀 Release Planning: ${version}

**Target Release Date:** ${targetDate}
**Created:** ${new Date().toLocaleDateString()}

## 📋 Release Checklist

### ✅ Pre-Release Tasks
- [ ] Review and merge all planned features
- [ ] Complete bug fixes and testing
- [ ] Update documentation
- [ ] Update changelog
- [ ] Perform security review
- [ ] Create release notes
- [ ] Test on all platforms (Windows, macOS, Linux)

### 🔄 Development Tasks
- [ ] Feature implementation
- [ ] Bug fixes
- [ ] Performance improvements
- [ ] Code review and testing

### 📦 Release Tasks
- [ ] Build and package application
- [ ] Sign binaries (if applicable)
- [ ] Create GitHub release
- [ ] Update website/documentation
- [ ] Notify users/stakeholders

### ✅ Post-Release Tasks
- [ ] Monitor for issues
- [ ] Collect user feedback
- [ ] Plan next release
- [ ] Update roadmap

## 🎯 Release Scope

### Features
<!-- Add features to be included in this release -->

### Bug Fixes
<!-- Add bug fixes to be included -->

### Known Issues
<!-- Add any known issues that won't be fixed -->

## 📊 Progress Tracking

**Overall Progress:** 0%

*This issue will be updated automatically as tasks are completed*

---

*Release planning issue created by automation system*`;
  }

  async generateWeeklyReport() {
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const sinceDate = oneWeekAgo.toISOString();

      // Get issues from last week
      const { data: issues } = await this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state: 'all',
        since: sinceDate,
        sort: 'updated',
        direction: 'desc'
      });

      // Get project cards
      const backlogCards = await this.octokit.rest.projects.listCards({
        column_id: this.columns['Backlog']
      });

      const todoCards = await this.octokit.rest.projects.listCards({
        column_id: this.columns['To Do']
      });

      const inProgressCards = await this.octokit.rest.projects.listCards({
        column_id: this.columns['In Progress']
      });

      const doneCards = await this.octokit.rest.projects.listCards({
        column_id: this.columns['Done']
      });

      const report = this.generateWeeklyReportBody({
        issues: issues,
        backlog: backlogCards.data,
        todo: todoCards.data,
        inProgress: inProgressCards.data,
        done: doneCards.data,
        reportDate: new Date()
      });

      return report;

    } catch (error) {
      console.error('Error generating weekly report:', error);
      throw error;
    }
  }

  generateWeeklyReportBody(data) {
    const closedIssues = data.issues.filter(i => i.state === 'closed');
    const newIssues = data.issues.filter(i => i.state === 'open' &&
      new Date(i.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    return `# 📊 Weekly Development Report

**Week Ending:** ${data.reportDate.toLocaleDateString()}

## 📈 Summary

- **New Issues:** ${newIssues.length}
- **Closed Issues:** ${closedIssues.length}
- **Backlog Items:** ${data.backlog.length}
- **To Do Items:** ${data.todo.length}
- **In Progress:** ${data.inProgress.length}
- **Completed This Week:** ${data.done.length}

## 🎯 Key Accomplishments

<!-- Add major accomplishments this week -->

## 🐛 Issues Closed

${closedIssues.slice(0, 5).map(issue =>
  `- [${issue.number}](${issue.html_url}) ${issue.title}`
).join('\n')}

${closedIssues.length > 5 ? `- and ${closedIssues.length - 5} more...` : ''}

## ✨ New Issues

${newIssues.slice(0, 5).map(issue =>
  `- [${issue.number}](${issue.html_url}) ${issue.title}`
).join('\n')}

${newIssues.length > 5 ? `- and ${newIssues.length - 5} more...` : ''}

## 📋 Current Sprint Status

**Backlog:** ${data.backlog.length} items
**To Do:** ${data.todo.length} items
**In Progress:** ${data.inProgress.length} items
**Done:** ${data.done.length} items

## 🎯 Next Week's Goals

<!-- Add goals for next week -->

---

*Report generated automatically on ${data.reportDate.toISOString()}*`;
  }
}

module.exports = ProjectAutomation;

// Export for use in GitHub Actions
if (typeof module !== 'undefined' && module.exports) {
  module.exports.ProjectAutomation = ProjectAutomation;
}