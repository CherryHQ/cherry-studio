# Rube Integration Guide

## Overview

Rube is a powerful Model Context Protocol (MCP) server that connects Cherry Studio to over 500 applications including Gmail, Slack, GitHub, Notion, and many more. With Rube, you can perform cross-application tasks using natural language commands directly from your AI conversations.

**Powered by [Composio](https://composio.dev)** - A leading platform for AI agent integrations.

## What is Rube?

Rube acts as a bridge between Cherry Studio and your favorite productivity apps. Instead of manually switching between applications, you can:

- Send emails via Gmail
- Create tasks and documents in Notion
- Post messages in Slack channels
- Create GitHub issues and pull requests
- Schedule calendar events
- And much more across 500+ supported applications

## Quick Setup

### 1. Enable Rube Server

1. Open Cherry Studio Settings (⚙️)
2. Navigate to **MCP → Builtin Servers**
3. Find **Rube** in the server list
4. Toggle the switch to **Enable** Rube
5. The server will automatically connect to `https://rube.app/mcp`

### 2. Authenticate Your Applications

When you first use Rube with a specific application, you'll be prompted to authenticate:

1. Rube will open an authentication dialog
2. Log in to the application you want to connect
3. Grant the necessary permissions
4. Return to Cherry Studio to continue

## Usage Examples

### Email Management
```
"Send an email to john@example.com with subject 'Project Update' and tell him the project is on track"
```

### Task Management
```
"Create a new task in Notion called 'Review Q4 budget' and set it to high priority"
```

### Team Communication
```
"Post a message in the #general Slack channel saying 'Meeting moved to 3 PM today'"
```

### Code Repository Management
```
"Create a GitHub issue titled 'Fix login bug' in the myproject repository with a description of the authentication error"
```

### Calendar Management
```
"Schedule a meeting for tomorrow at 2 PM called 'Sprint Planning' and invite the dev team"
```

## Supported Applications

Rube supports over 500 applications across various categories:

### **Productivity & Office**
- Gmail, Outlook
- Google Drive, OneDrive
- Microsoft Office Suite
- Google Workspace

### **Project Management**
- Notion, Asana, Trello
- Monday.com, ClickUp
- Jira, Linear

### **Communication**
- Slack, Microsoft Teams
- Discord, Telegram
- Zoom, Google Meet

### **Development**
- GitHub, GitLab, Bitbucket
- Docker, AWS, GCP
- Jenkins, CircleCI

### **CRM & Sales**
- Salesforce, HubSpot
- Pipedrive, Airtable
- Zendesk, Intercom

*And many more! Visit [rube.app](https://rube.app) for the complete list.*

## Configuration

### Basic Configuration

Rube works out of the box with minimal configuration:

- **Server URL**: `https://rube.app/mcp` (automatically set)
- **Authentication**: OAuth-based (handled automatically)
- **Status**: Inactive by default (enable when ready to use)

### Advanced Settings

If you need to customize Rube's behavior:

1. Go to **MCP Settings → Rube**
2. You can configure:
   - Custom headers (if needed for enterprise setups)
   - Timeout settings
   - Disabled tools (to restrict certain functionalities)

## Authentication & Security

### OAuth Authentication

Rube uses industry-standard OAuth authentication:

- **Secure**: Your credentials are never stored by Rube
- **Granular**: You control which permissions each app receives  
- **Revocable**: You can revoke access at any time from the app's settings

### Privacy & Data Handling

- **No Data Storage**: Rube doesn't store your personal data
- **Encrypted Transit**: All communications use HTTPS/TLS encryption
- **Composio Security**: Built on Composio's enterprise-grade security infrastructure

## Troubleshooting

### Common Issues

**Issue**: Rube server won't connect
- **Solution**: Check your internet connection and firewall settings
- **Alternative**: Restart Cherry Studio and try again

**Issue**: Authentication fails for an application
- **Solution**: Clear browser cookies for that app and re-authenticate
- **Check**: Ensure the app account has necessary permissions

**Issue**: Commands aren't working as expected
- **Solution**: Be more specific in your requests (include app names, specific actions)
- **Example**: Instead of "create task", use "create a task in Notion"

**Issue**: Server appears inactive
- **Solution**: Make sure you've enabled Rube in MCP Settings
- **Check**: Look for any error messages in the Cherry Studio logs

### Getting Help

- **Documentation**: Visit [rube.app](https://rube.app) for detailed guides
- **Support**: Contact Composio support for integration issues
- **Cherry Studio**: Use GitHub issues for Cherry Studio-specific problems

## Advanced Usage

### Batch Operations
```
"Create three GitHub issues: 'Fix header styling', 'Add dark mode toggle', and 'Update README' in the myproject repository"
```

### Cross-App Workflows
```
"When the GitHub issue 'Feature X' is closed, send a Slack message to #dev channel and create a Notion page summarizing the implementation"
```

### Conditional Actions
```
"If there are any high-priority emails in my inbox, create a summary in Notion and set a reminder for 1 hour"
```

## Benefits

### For Individual Users
- **Unified Interface**: Control all apps from one place
- **Natural Language**: No need to remember complex commands or APIs
- **Time Savings**: Reduce context switching between applications
- **Automation**: Create workflows across multiple platforms

### For Teams
- **Consistent Communication**: Standardize how team members interact with tools
- **Knowledge Sharing**: Document and share app interactions
- **Onboarding**: New team members can be productive immediately
- **Compliance**: Maintain audit trails of actions across platforms

## Best Practices

### Writing Effective Commands

1. **Be Specific**: Include app names and specific actions
   - ❌ "Create a document"  
   - ✅ "Create a document in Google Drive"

2. **Include Context**: Provide relevant details
   - ❌ "Send a message"
   - ✅ "Send a message to the #marketing Slack channel"

3. **Use Natural Language**: Write as you would speak
   - ✅ "Schedule a meeting with the design team for next Tuesday at 10 AM"

### Security Best Practices

1. **Regular Review**: Periodically review connected applications
2. **Least Privilege**: Only grant necessary permissions
3. **Team Access**: Use shared accounts for team resources when appropriate
4. **Audit Trail**: Monitor actions performed through Rube

## Updates and Maintenance

Rube is continuously updated with:
- **New Integrations**: Regular addition of new applications
- **Feature Enhancements**: Improved natural language understanding
- **Security Updates**: Latest security patches and protocols
- **Bug Fixes**: Resolution of reported issues

Updates are automatically available as Rube runs as a hosted service.

## Conclusion

Rube transforms Cherry Studio into a powerful command center for your digital workplace. By connecting to hundreds of applications through natural language, it eliminates the friction of switching between tools and enables powerful automation workflows.

Start with simple commands like sending emails or creating tasks, then gradually explore more complex cross-application workflows as you become comfortable with the system.

---

**Need Help?** 
- Visit [rube.app](https://rube.app) for more information
- Check the [Composio documentation](https://docs.composio.dev) for advanced features
- Join the Cherry Studio community for tips and best practices
