---
icon: stethoscope
---
# MCP Troubleshooting

When an MCP server doesn't work, check it in order: first the server on its own, then the Agent that uses it. Changing several settings at once makes it hard to tell what fixed, or broke, things.

<figure><img src="../../../../../assets/1c9c5db7c330fdc7de184c2c.webp" alt="MCP troubleshooting flowchart from server startup, runtime environment, authentication network, to Agent binding and call chain"><figcaption><p>Work through the steps from left to right</p></figcaption></figure>

## Troubleshooting Order

{% stepper %}
{% step %}
### 1. Does the Server Start on Its Own?

Open **Settings → MCP → MCP Servers** and check that the server is enabled and its status is normal. If it isn't, open the server details and read the logs before changing anything.
{% endstep %}

{% step %}
### 2. Runtime Environment

For local servers, check the command, arguments and paths exactly as the provider documents them. Many servers need `uv` or `bun`; if the logs say a command is not found, install it in [Settings → Dependencies](../../../pre-basic/settings/env-dependencies.md).
{% endstep %}

{% step %}
### 3. Authentication and Network

Check that API keys and other environment variables are filled in and still valid, and that the URL of a remote server is reachable. If you use a proxy, make sure it allows the server's address.
{% endstep %}

{% step %}
### 4. Binding and Permissions

Open **Work → Agent menu → Edit → MCP** and confirm the server is enabled for this Agent. Check that the tools you need are not turned off and that no permission request is waiting for approval. After changing the Agent configuration, send a new message so it loads the new tools.
{% endstep %}

{% step %}
### 5. Call Chain

If the tool is called but the result is wrong, find the last step that worked: look at the parameters the Agent sent and compare them with the tool's description and required parameters in the server details.
{% endstep %}
{% endstepper %}

## Common Symptoms

| Symptom | Likely cause | What to check |
| --- | --- | --- |
| Server won't start | Wrong command or missing runtime | Logs, command and arguments, Settings → Dependencies |
| `command not found` (uv, bun, npx) | Runtime not installed | Install it in Settings → Dependencies |
| 401 or 403 errors | Missing or expired key | Environment variables and the provider's account |
| Timeouts | Remote server unreachable | URL, network and proxy |
| Server is connected, but the Agent can't find its tools | Not bound to this Agent, or tools disabled | Edit Agent → MCP, then send a new message |
| Agent calls the tool with the wrong input | Parameters misunderstood | Tool description and required parameters in the server details |

{% hint style="danger" %}
Do not paste API keys or full logs containing secrets into conversations, screenshots or public issues. Mask them first.
{% endhint %}

<details>

<summary>Should I delete and re-add the server?</summary>

First, check the logs and fix issues one by one. Only delete and recreate the server if the configuration is severely corrupted and the source can be re-obtained. Before deleting, save a copy of the configuration that does not contain secrets.

</details>

<details>

<summary>The server works in another app but not in Cherry Studio. Why?</summary>

The two apps may run it with different commands, paths or environment variables. Copy the exact configuration from the working app, then check that the runtime it relies on is available in Settings → Dependencies.

</details>
