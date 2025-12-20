# Agent Web Tools Troubleshooting Guide

This document provides troubleshooting information for WebFetch and WebSearch tools in Cherry Studio's Agent (Claude Code) feature.

## WebFetch Tool

### Issue: "Claude Code is unable to fetch from [domain]"

**Status**: ✅ Fixed in this PR

**Root Cause**: The Claude Code SDK was not receiving proxy environment variables, preventing it from accessing external URLs through configured proxies.

**Solution**: Proxy environment variables are now preserved and passed to the Claude Code SDK.

### Testing WebFetch

1. **Configure Proxy** (if needed):
   - Go to Settings → Network → Proxy
   - Configure your proxy settings
   - Ensure the proxy is active

2. **Create Agent Session**:
   - Create a new Agent session
   - Ensure WebFetch tool is enabled in allowed tools

3. **Test the Tool**:
   ```
   User: Fetch the content from https://www.example.com
   
   Expected: Claude Code successfully fetches and returns the page content
   ```

4. **Check Logs**:
   - Enable debug logging if available
   - Look for "Preserving proxy env var for Claude Code SDK" messages
   - Verify the proxy variables are being set correctly

### Common Issues

#### WebFetch Still Failing

If WebFetch continues to fail after the fix:

1. **Verify Proxy Configuration**:
   - Check that your proxy settings are correct
   - Test the proxy with other tools (e.g., web browser, curl)

2. **Check Firewall/Security**:
   - Some corporate firewalls may block Claude Code SDK
   - Verify that the domain you're trying to fetch is accessible

3. **Check Bypass Rules**:
   - If using proxy bypass rules, ensure the target domain is not being bypassed incorrectly

## WebSearch Tool

### Issue: API Error 400 - "missing field input_schema"

**Status**: ⚠️ Upstream SDK Issue

**Root Cause**: The `@anthropic-ai/claude-agent-sdk` v0.1.62 does not properly serialize tool definitions when making API calls to Anthropic. The SDK omits the required `input_schema` field from tool definitions.

**Error Message**:
```
API Error: 400 {"error":{"message":"Failed to deserialize the JSON body into the target type: tools[0]: missing field `input_schema`"}}
```

### Workaround

While waiting for an SDK fix, users can:

1. **Use Cherry Studio's Built-in Web Search**:
   - Enable web search in the main chat interface
   - Configure your preferred web search provider (Settings → Web Search)
   - Use regular chat instead of Agent sessions for web search needs

2. **Use MCP Web Search Tools**:
   - Install an MCP server that provides web search functionality
   - Configure the MCP server in Cherry Studio
   - Enable the MCP tools in your Agent session

3. **Use Alternative Agents**:
   - Consider using other agent implementations that don't rely on the Claude Agent SDK

### Monitoring for Fixes

This issue requires one of the following:

1. **SDK Upgrade**: Anthropic releases a new version of `@anthropic-ai/claude-agent-sdk` that fixes tool serialization
2. **Cherry Studio Patch**: A comprehensive patch is created to fix the SDK's tool serialization
3. **API Changes**: Anthropic changes the API to accept tool definitions without `input_schema`

Check the following for updates:
- This GitHub issue/PR
- [Anthropic SDK releases](https://github.com/anthropics/anthropic-sdk-typescript) (Note: The `@anthropic-ai/claude-agent-sdk` is a separate package but monitored for updates here)
- Cherry Studio release notes

## Environment Variables Reference

The following proxy environment variables are now supported in Claude Code Agent:

- `HTTP_PROXY` / `http_proxy` - HTTP proxy URL
- `HTTPS_PROXY` / `https_proxy` - HTTPS proxy URL  
- `NO_PROXY` / `no_proxy` - Comma-separated list of domains to bypass proxy

**Format**: `http://proxy.example.com:8080` or `socks5://proxy.example.com:1080`

## Debug Logging

To enable detailed logging for Agent tools:

1. Set environment variable `DEBUG_CLAUDE_AGENT_SDK=1` before starting Cherry Studio
2. Check the application logs for detailed information about:
   - Tool execution
   - Proxy configuration
   - Network requests
   - API errors

## Related Files

- `/src/main/services/agents/services/claudecode/index.ts` - Agent service implementation
- `/src/main/services/ProxyManager.ts` - Proxy configuration management
- `/src/main/services/agents/services/claudecode/tools.ts` - Tool definitions

## Reporting Issues

If you encounter issues with WebFetch or WebSearch tools:

1. Check this troubleshooting guide first
2. Enable debug logging
3. Collect relevant log information
4. Create a GitHub issue with:
   - Cherry Studio version
   - Operating system
   - Proxy configuration (if applicable)
   - Error messages and logs
   - Steps to reproduce
