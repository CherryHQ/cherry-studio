---
icon: bot
---

# Agents and tools

An agent saves a name, avatar, instructions, default model, and approval preference. Keep recurring requirements in the agent and open separate conversations for different topics. Attach the current files and task to the message.

In Standard mode, available built-in tools depend on the model, device, system permissions, and configured services. Skills and custom MCP connections have separate agent bindings.

## Create a reusable agent

1. Open **Agents** in the sidebar and add one, or create one from the chat header's agent picker.
2. Enter a name and avatar. Choose **Edit** in the instructions section, write the requirements, then return to the form.
3. Select a mode and model. Files, skills, plugins, and device tools require **Standard** mode and a tool-capable text model.
4. Choose an approval preference and optionally **Add MCP**. After creation, use the editor to **Add Skill**.
5. Tap **Save**. Creating from the chat picker opens a draft; creating from the management list returns to the list.

For example:

> Help organize my work materials. Start with a three-sentence summary, then list action items. Mark missing owners and deadlines as “To confirm” instead of inventing them. Answer in English.

Keep API keys and account passwords out of instructions.

## Do edits need saving?

Tap the **current agent's name** in the chat header to open its editor without leaving the conversation. The management list opens the same form.

**Creation requires Save; existing agents save automatically.** Names and instructions save after a typing pause. Avatar, model, approval, and binding changes save through their respective actions. Done in the instruction editor returns to the form; a new agent still needs the final Save. Retain the draft and retry if saving fails.

You can save an agent without a model, but must choose an available model before chatting. The instructions section shows a summary; choose **Edit** for the complete text.

## Standard and Minimal modes

| Mode | Best for | Scope |
| --- | --- | --- |
| Standard | Files, skills, plugins, and device tasks | Available app tools and model web capabilities |
| Minimal | Text chat and image understanding | No app tools, skills, or plugins; supported native model web access remains available |

Switching modes retains Skill, MCP, and approval settings for returning to Standard. Reauthorizing an account does not extend Minimal mode's scope.

## Approval modes

| Mode | Behavior |
| --- | --- |
| Confirm when needed | Follows each tool's rules; some reads and file creation/editing proceed directly |
| Automatic approval | Approves eligible operations while retaining system permissions, configuration, and resource limits |

New agents default to **Approve automatically**; existing agents keep their preference. Choose **Ask when needed** if eligible calendar writes or external changes should ask first.

The **image-generation tool** and **health-record reads** retain separate confirmation even with automatic approval. SSH has its own approvals and limited diagnostic grants; see [SSH](ssh.md).

Inspect the target, operation, and data recipient before allowing or denying. An OS permission prompt may follow app approval. Stopping a reply, deleting history, or changing mode does not undo completed external actions.

## System tools on your device

You no longer enable built-in capabilities separately for each agent. At the start of a new request, the app considers model support, platform, grantable or existing system permissions, and configured drawing/web services. Unavailable tools may not be offered to the model.

| Capability | Example | Availability |
| --- | --- | --- |
| Calendar | “List tomorrow's events” | iOS and Android, subject to read/write access and system support |
| Reminders | “Remind me tomorrow at 9 am to mail the parcel” | iOS; not currently offered on Android |
| Health records | “Summarize recorded steps and workouts this week” | iOS, for supported and authorized data types |
| Current location | “Get my location, then find nearby stations” | iOS and Android, with location permission |
| App files | “Save the summary as a file” | Accessible attachments, generated files, and workspace material |

Use **Settings → System permissions** to manage access. Revoke permissions through the appropriate system settings; the retired agent switches can no longer disable a device capability. Some Android calendar actions need completion in a system form; opening it is not proof of saving.

Local tools cannot freely inspect every phone file or take over other apps. [Desktop agents](remote-chat.md), [remote desktop](remote-desktop.md), and [SSH](ssh.md) are separate connection workflows.

## Where do I configure other tools?

* **Web:** configure source preference and services in **Plugins → Built-in tools → Web search / URL fetch**. See [web search](web-search.md).
* **Plugins:** connect Feishu, Notion, or other accounts on Plugins; **＋ → Plugins** can name one for a message. See [plugins](plugins.md).
* **MCP:** configure and enable a remote server on Plugins, then **Add MCP** in the agent editor. Removing a binding does not delete the server.
* **Skills:** install first, then **Add Skill** in the editor. Removing the binding does not uninstall it. See [Skills](skills.md).
* **Drawing:** choose a drawing model in **Settings → Default model**. A tool-capable Standard text model can call it when needed, or you can select an image model directly. See [image generation](image-generation.md).

Organization-managed agents may have locked or hidden fields, a model pool, and fixed Skill/MCP bindings. Change organization-owned configuration at its source; local editable fields follow the screen's policy. See [accounts and organization spaces](accounts-and-organizations.md).

## Why does a tool remain unavailable after authorization?

Check Standard mode, model tool support, service connections, global MCP enablement and agent bindings, system permissions, and organization policy. Signing in does not grant access to every document or operation.

Give a precise target such as a document link, date range, or filename. Ask it to read and list the target before requesting changes. See [Let AI Use Tools](using-tools.md) for execution, approval, and failure handling.
