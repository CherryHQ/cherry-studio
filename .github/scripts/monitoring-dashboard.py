#!/usr/bin/env python3
"""
AutomatSEO Upstream Monitoring Dashboard

This script provides a comprehensive monitoring dashboard for tracking
upstream Cherry Studio activity and its impact on AutomatSEO development.
"""

import json
import os
import sys
import datetime
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional
import requests
from github import Github
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd

# Configuration
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN')
UPSTREAM_REPO = "CherryHQ/cherry-studio"
DOWNSTREAM_REPO = "imrshohel/automatseo"

@dataclass
class ActivityMetrics:
    """Metrics for tracking upstream and downstream activity"""
    date: str
    upstream_issues_opened: int = 0
    upstream_issues_closed: int = 0
    upstream_prs_opened: int = 0
    upstream_prs_merged: int = 0
    upstream_releases: int = 0
    downstream_tasks_created: int = 0
    downstream_tasks_completed: int = 0
    sync_activities: int = 0

class UpstreamMonitor:
    """Main monitoring class for tracking upstream activity"""

    def __init__(self, github_token: str):
        self.github = Github(github_token)
        self.upstream_repo = self.github.get_repo(UPSTREAM_REPO)
        self.downstream_repo = self.github.get_repo(DOWNSTREAM_REPO)
        self.metrics_history: List[ActivityMetrics] = []

    def collect_daily_metrics(self, date: datetime.date) -> ActivityMetrics:
        """Collect metrics for a specific date"""
        print(f"Collecting metrics for {date}")

        metrics = ActivityMetrics(date=date.isoformat())

        # Get upstream issues activity
        upstream_issues = list(self.upstream_repo.get_issues(
            state="all",
            sort="created",
            direction="desc"
        ))

        # Filter by date
        issues_on_date = [issue for issue in upstream_issues
                         if issue.created_at.date() == date]
        issues_closed_on_date = [issue for issue in upstream_issues
                               if issue.closed_at and issue.closed_at.date() == date]

        metrics.upstream_issues_opened = len(issues_on_date)
        metrics.upstream_issues_closed = len(issues_closed_on_date)

        # Get upstream PRs activity
        upstream_prs = list(self.upstream_repo.get_pulls(
            state="all",
            sort="created",
            direction="desc"
        ))

        prs_on_date = [pr for pr in upstream_prs
                      if pr.created_at.date() == date]
        prs_merged_on_date = [pr for pr in upstream_prs
                             if pr.merged and pr.merged_at.date() == date]

        metrics.upstream_prs_opened = len(prs_on_date)
        metrics.upstream_prs_merged = len(prs_merged_on_date)

        # Get upstream releases
        releases = list(self.upstream_repo.get_releases())
        releases_on_date = [rel for rel in releases
                          if rel.published_at and rel.published_at.date() == date]

        metrics.upstream_releases = len(releases_on_date)

        # Get downstream activity
        downstream_issues = list(self.downstream_repo.get_issues(
            state="all",
            labels=["upstream-sync"],
            sort="created",
            direction="desc"
        ))

        tasks_created_on_date = [issue for issue in downstream_issues
                                if issue.created_at.date() == date]
        tasks_completed_on_date = [issue for issue in downstream_issues
                                  if issue.closed_at and issue.closed_at.date() == date]

        metrics.downstream_tasks_created = len(tasks_created_on_date)
        metrics.downstream_tasks_completed = len(tasks_completed_on_date)

        # Count sync-related activities
        sync_labels = ["upstream-sync", "upstream-pr", "upstream-release"]
        sync_activities = 0

        for label in sync_labels:
            labeled_issues = list(self.downstream_repo.get_issues(
                state="all",
                labels=[label],
                sort="updated",
                direction="desc"
            ))
            sync_activities += len([issue for issue in labeled_issues
                                 if issue.updated_at.date() == date])

        metrics.sync_activities = sync_activities

        return metrics

    def analyze_upstream_trends(self, days: int = 30) -> Dict:
        """Analyze trends in upstream activity"""
        print(f"Analyzing trends for the last {days} days")

        trends = {
            "issue_categories": {},
            "pr_types": {},
            "release_frequency": 0,
            "top_contributors": {},
            "complexity_trends": {}
        }

        # Get recent issues for categorization
        recent_issues = list(self.upstream_repo.get_issues(
            state="all",
            sort="created",
            direction="desc"
        ))[:100]  # Last 100 issues

        # Categorize issues
        for issue in recent_issues:
            title = issue.title.lower()
            body = issue.body.lower() if issue.body else ""
            text = f"{title} {body}"

            # Simple categorization
            if any(keyword in text for keyword in ["bug", "error", "crash", "fix"]):
                trends["issue_categories"]["bug"] = trends["issue_categories"].get("bug", 0) + 1
            elif any(keyword in text for keyword in ["feature", "enhancement", "add"]):
                trends["issue_categories"]["feature"] = trends["issue_categories"].get("feature", 0) + 1
            elif any(keyword in text for keyword in ["docs", "documentation", "readme"]):
                trends["issue_categories"]["documentation"] = trends["issue_categories"].get("documentation", 0) + 1
            elif any(keyword in text for keyword in ["performance", "optimization", "speed"]):
                trends["issue_categories"]["performance"] = trends["issue_categories"].get("performance", 0) + 1
            else:
                trends["issue_categories"]["other"] = trends["issue_categories"].get("other", 0) + 1

            # Track contributors
            author = issue.user.login
            trends["top_contributors"][author] = trends["top_contributors"].get(author, 0) + 1

        # Analyze PRs
        recent_prs = list(self.upstream_repo.get_pulls(
            state="all",
            sort="created",
            direction="desc"
        ))[:100]  # Last 100 PRs

        for pr in recent_prs:
            title = pr.title.lower()
            body = pr.body.lower() if pr.body else ""
            text = f"{title} {body}"

            if any(keyword in text for keyword in ["fix", "bugfix"]):
                trends["pr_types"]["fix"] = trends["pr_types"].get("fix", 0) + 1
            elif any(keyword in text for keyword in ["feat", "feature"]):
                trends["pr_types"]["feature"] = trends["pr_types"].get("feature", 0) + 1
            elif any(keyword in text for keyword in ["refactor", "cleanup"]):
                trends["pr_types"]["refactor"] = trends["pr_types"].get("refactor", 0) + 1
            elif any(keyword in text for keyword in ["docs", "documentation"]):
                trends["pr_types"]["documentation"] = trends["pr_types"].get("documentation", 0) + 1
            else:
                trends["pr_types"]["other"] = trends["pr_types"].get("other", 0) + 1

            # Track PR contributors
            author = pr.user.login
            trends["top_contributors"][author] = trends["top_contributors"].get(author, 0) + 1

        # Calculate release frequency
        releases = list(self.upstream_repo.get_releases())
        if len(releases) > 1:
            latest = releases[0].published_at
            oldest = releases[-1].published_at
            days_diff = (latest - oldest).days
            trends["release_frequency"] = len(releases) / max(days_diff / 30, 1)  # releases per month

        # Sort contributors by activity
        trends["top_contributors"] = dict(
            sorted(trends["top_contributors"].items(),
                  key=lambda x: x[1], reverse=True)[:10]
        )

        return trends

    def generate_dashboard_data(self) -> Dict:
        """Generate comprehensive dashboard data"""
        print("Generating dashboard data...")

        today = datetime.date.today()

        # Collect metrics for the last 30 days
        metrics_data = []
        for i in range(30):
            date = today - datetime.timedelta(days=i)
            try:
                metrics = self.collect_daily_metrics(date)
                metrics_data.append(metrics)
            except Exception as e:
                print(f"Error collecting metrics for {date}: {e}")
                continue

        # Generate trends
        trends = self.analyze_upstream_trends(30)

        # Calculate summary statistics
        total_upstream_issues = sum(m.upstream_issues_opened for m in metrics_data)
        total_upstream_prs = sum(m.upstream_prs_opened for m in metrics_data)
        total_downstream_tasks = sum(m.downstream_tasks_created for m in metrics_data)

        sync_efficiency = 0
        if total_upstream_issues > 0:
            sync_efficiency = (total_downstream_tasks / total_upstream_issues) * 100

        dashboard_data = {
            "summary": {
                "total_upstream_issues": total_upstream_issues,
                "total_upstream_prs": total_upstream_prs,
                "total_downstream_tasks": total_downstream_tasks,
                "sync_efficiency": round(sync_efficiency, 2),
                "data_period": f"Last 30 days ({(today - datetime.timedelta(days=29)).isoformat()} to {today.isoformat()})"
            },
            "trends": trends,
            "daily_metrics": [asdict(m) for m in metrics_data],
            "current_status": {
                "last_sync": self.get_last_sync_time(),
                "active_monitoring": True,
                "upstream_repo_status": "Active",
                "downstream_repo_status": "Active"
            }
        }

        return dashboard_data

    def get_last_sync_time(self) -> str:
        """Get the last upstream sync time"""
        try:
            # Look for recent sync activities in downstream issues
            sync_issues = list(self.downstream_repo.get_issues(
                state="all",
                labels=["upstream-sync"],
                sort="updated",
                direction="desc"
            ))[:5]

            if sync_issues:
                last_sync = max(issue.updated_at for issue in sync_issues)
                return last_sync.isoformat()
            else:
                return "No recent syncs found"
        except Exception as e:
            print(f"Error getting last sync time: {e}")
            return "Unknown"

    def create_visualizations(self, data: Dict) -> Dict[str, str]:
        """Create visualization charts"""
        print("Creating visualizations...")

        visualizations = {}

        # Convert metrics to DataFrame
        df = pd.DataFrame(data["daily_metrics"])
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values('date')

        # Set up the plotting style
        plt.style.use('seaborn-v0_8')
        sns.set_palette("husl")

        # 1. Activity Over Time
        fig, axes = plt.subplots(2, 2, figsize=(15, 10))
        fig.suptitle('Upstream Activity Trends (Last 30 Days)', fontsize=16)

        # Issues and PRs
        axes[0, 0].plot(df['date'], df['upstream_issues_opened'], label='Issues Opened', marker='o')
        axes[0, 0].plot(df['date'], df['upstream_prs_opened'], label='PRs Opened', marker='s')
        axes[0, 0].set_title('Issues & PRs Opened')
        axes[0, 0].set_ylabel('Count')
        axes[0, 0].legend()
        axes[0, 0].tick_params(axis='x', rotation=45)

        # Downstream Tasks
        axes[0, 1].plot(df['date'], df['downstream_tasks_created'],
                       label='Tasks Created', marker='o', color='green')
        axes[0, 1].plot(df['date'], df['downstream_tasks_completed'],
                       label='Tasks Completed', marker='s', color='red')
        axes[0, 1].set_title('Downstream Task Activity')
        axes[0, 1].set_ylabel('Count')
        axes[0, 1].legend()
        axes[0, 1].tick_params(axis='x', rotation=45)

        # Sync Activities
        axes[1, 0].plot(df['date'], df['sync_activities'],
                       marker='o', color='purple')
        axes[1, 0].set_title('Sync Activities')
        axes[1, 0].set_ylabel('Count')
        axes[1, 0].tick_params(axis='x', rotation=45)

        # Cumulative Metrics
        axes[1, 1].plot(df['date'], df['upstream_issues_opened'].cumsum(),
                       label='Cumulative Issues', marker='o')
        axes[1, 1].plot(df['date'], df['upstream_prs_opened'].cumsum(),
                       label='Cumulative PRs', marker='s')
        axes[1, 1].set_title('Cumulative Activity')
        axes[1, 1].set_ylabel('Total Count')
        axes[1, 1].legend()
        axes[1, 1].tick_params(axis='x', rotation=45)

        plt.tight_layout()
        plt.savefig('/tmp/activity_trends.png', dpi=300, bbox_inches='tight')
        plt.close()
        visualizations['activity_trends'] = '/tmp/activity_trends.png'

        # 2. Issue Categories Pie Chart
        categories = data["trends"]["issue_categories"]
        if categories:
            fig, ax = plt.subplots(figsize=(10, 6))

            colors = plt.cm.Set3(range(len(categories)))
            wedges, texts, autotexts = ax.pie(categories.values(), labels=categories.keys(),
                                            autopct='%1.1f%%', colors=colors, startangle=90)

            ax.set_title('Upstream Issue Categories Distribution', fontsize=14, pad=20)

            # Improve text readability
            for autotext in autotexts:
                autotext.set_color('white')
                autotext.set_weight('bold')

            plt.tight_layout()
            plt.savefig('/tmp/issue_categories.png', dpi=300, bbox_inches='tight')
            plt.close()
            visualizations['issue_categories'] = '/tmp/issue_categories.png'

        # 3. Top Contributors Bar Chart
        contributors = data["trends"]["top_contributors"]
        if contributors:
            fig, ax = plt.subplots(figsize=(12, 8))

            # Take top 10 contributors
            top_contributors = dict(list(contributors.items())[:10])
            names = list(top_contributors.keys())
            counts = list(top_contributors.values())

            bars = ax.bar(range(len(names)), counts, color='skyblue', edgecolor='navy')

            ax.set_title('Top 10 Upstream Contributors (Last 30 Days)', fontsize=14, pad=20)
            ax.set_xlabel('Contributors')
            ax.set_ylabel('Activity Count')
            ax.set_xticks(range(len(names)))
            ax.set_xticklabels(names, rotation=45, ha='right')

            # Add value labels on bars
            for bar, count in zip(bars, counts):
                height = bar.get_height()
                ax.text(bar.get_x() + bar.get_width()/2., height,
                       f'{count}', ha='center', va='bottom')

            plt.tight_layout()
            plt.savefig('/tmp/top_contributors.png', dpi=300, bbox_inches='tight')
            plt.close()
            visualizations['top_contributors'] = '/tmp/top_contributors.png'

        return visualizations

    def generate_html_report(self, data: Dict, visualizations: Dict) -> str:
        """Generate HTML dashboard report"""
        print("Generating HTML dashboard...")

        html_template = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutomatSEO Upstream Monitoring Dashboard</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 3px solid #e1e1e1;
        }
        .header h1 {
            color: #2c3e50;
            margin: 0;
            font-size: 2.5em;
        }
        .header p {
            color: #7f8c8d;
            margin: 10px 0 0 0;
            font-size: 1.1em;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .summary-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            font-size: 1.1em;
            opacity: 0.9;
        }
        .summary-card .number {
            font-size: 2.5em;
            font-weight: bold;
            margin: 0;
        }
        .section {
            margin-bottom: 40px;
        }
        .section h2 {
            color: #2c3e50;
            border-bottom: 2px solid #e1e1e1;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .chart-container {
            text-align: center;
            margin: 20px 0;
        }
        .chart-container img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .status-item {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #28a745;
        }
        .status-item.warning {
            border-left-color: #ffc107;
        }
        .status-item.error {
            border-left-color: #dc3545;
        }
        .status-item strong {
            display: block;
            color: #495057;
            margin-bottom: 5px;
        }
        .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e1e1e1;
            color: #7f8c8d;
        }
        .refresh-info {
            background-color: #e8f5e8;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid #28a745;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 AutomatSEO Upstream Monitoring Dashboard</h1>
            <p>Real-time tracking of Cherry Studio upstream activity and its impact on AutomatSEO development</p>
        </div>

        <div class="refresh-info">
            <strong>📊 Last Updated:</strong> {timestamp} |
            <strong>📅 Data Period:</strong> {data_period}
        </div>

        <div class="summary-grid">
            <div class="summary-card">
                <h3>📝 Upstream Issues</h3>
                <div class="number">{total_upstream_issues}</div>
            </div>
            <div class="summary-card">
                <h3>🔀 Upstream PRs</h3>
                <div class="number">{total_upstream_prs}</div>
            </div>
            <div class="summary-card">
                <h3>📋 Downstream Tasks</h3>
                <div class="number">{total_downstream_tasks}</div>
            </div>
            <div class="summary-card">
                <h3>📈 Sync Efficiency</h3>
                <div class="number">{sync_efficiency}%</div>
            </div>
        </div>

        <div class="section">
            <h2>📈 Activity Trends</h2>
            <div class="chart-container">
                <img src="data:image/png;base64,{activity_trends_img}" alt="Activity Trends">
            </div>
        </div>

        <div class="section">
            <h2>📊 Issue Categories Distribution</h2>
            <div class="chart-container">
                <img src="data:image/png;base64,{issue_categories_img}" alt="Issue Categories">
            </div>
        </div>

        <div class="section">
            <h2>👥 Top Contributors</h2>
            <div class="chart-container">
                <img src="data:image/png;base64,{top_contributors_img}" alt="Top Contributors">
            </div>
        </div>

        <div class="section">
            <h2>🔧 System Status</h2>
            <div class="status-grid">
                <div class="status-item">
                    <strong>Last Sync</strong>
                    {last_sync}
                </div>
                <div class="status-item">
                    <strong>Monitoring Status</strong>
                    <span style="color: #28a745;">✅ Active</span>
                </div>
                <div class="status-item">
                    <strong>Upstream Repo</strong>
                    <span style="color: #28a745;">✅ {upstream_status}</span>
                </div>
                <div class="status-item">
                    <strong>Downstream Repo</strong>
                    <span style="color: #28a745;">✅ {downstream_status}</span>
                </div>
            </div>
        </div>

        <div class="footer">
            <p>🤖 Dashboard generated automatically by AutomatSEO monitoring system</p>
            <p>For questions or issues, contact the development team</p>
        </div>
    </div>
</body>
</html>
        """

        # Encode images to base64
        import base64

        activity_trends_img = ""
        issue_categories_img = ""
        top_contributors_img = ""

        if 'activity_trends' in visualizations:
            with open(visualizations['activity_trends'], 'rb') as f:
                activity_trends_img = base64.b64encode(f.read()).decode()

        if 'issue_categories' in visualizations:
            with open(visualizations['issue_categories'], 'rb') as f:
                issue_categories_img = base64.b64encode(f.read()).decode()

        if 'top_contributors' in visualizations:
            with open(visualizations['top_contributors'], 'rb') as f:
                top_contributors_img = base64.b64encode(f.read()).decode()

        # Fill in template
        html_content = html_template.format(
            timestamp=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC"),
            data_period=data["summary"]["data_period"],
            total_upstream_issues=data["summary"]["total_upstream_issues"],
            total_upstream_prs=data["summary"]["total_upstream_prs"],
            total_downstream_tasks=data["summary"]["total_downstream_tasks"],
            sync_efficiency=data["summary"]["sync_efficiency"],
            activity_trends_img=activity_trends_img,
            issue_categories_img=issue_categories_img,
            top_contributors_img=top_contributors_img,
            last_sync=data["current_status"]["last_sync"],
            upstream_status=data["current_status"]["upstream_repo_status"],
            downstream_status=data["current_status"]["downstream_repo_status"]
        )

        return html_content

def main():
    """Main function to run the monitoring dashboard"""
    if not GITHUB_TOKEN:
        print("Error: GITHUB_TOKEN environment variable is required")
        sys.exit(1)

    try:
        # Initialize monitor
        monitor = UpstreamMonitor(GITHUB_TOKEN)

        # Generate dashboard data
        print("Generating dashboard data...")
        dashboard_data = monitor.generate_dashboard_data()

        # Create visualizations
        print("Creating visualizations...")
        visualizations = monitor.create_visualizations(dashboard_data)

        # Generate HTML report
        print("Generating HTML dashboard...")
        html_report = monitor.generate_html_report(dashboard_data, visualizations)

        # Save outputs
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        # Save JSON data
        with open(f'/tmp/dashboard_data_{timestamp}.json', 'w') as f:
            json.dump(dashboard_data, f, indent=2)

        # Save HTML dashboard
        with open(f'/tmp/dashboard_{timestamp}.html', 'w') as f:
            f.write(html_report)

        print(f"✅ Dashboard generated successfully!")
        print(f"📊 Data saved: /tmp/dashboard_data_{timestamp}.json")
        print(f"🖥️  Dashboard saved: /tmp/dashboard_{timestamp}.html")

        # Print summary
        summary = dashboard_data["summary"]
        print(f"\n📈 SUMMARY FOR LAST 30 DAYS:")
        print(f"   📝 Upstream Issues: {summary['total_upstream_issues']}")
        print(f"   🔀 Upstream PRs: {summary['total_upstream_prs']}")
        print(f"   📋 Downstream Tasks: {summary['total_downstream_tasks']}")
        print(f"   📈 Sync Efficiency: {summary['sync_efficiency']}%")

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()