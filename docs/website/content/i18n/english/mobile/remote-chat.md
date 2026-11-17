---
icon: monitor-smartphone
---

# Use desktop agents from your phone

After pairing a compatible Cherry Studio Desktop, use your phone to read desktop agent conversations, send tasks, answer questions, and handle tool approvals. **The computer executes the task; the phone provides access.** This guide describes Mobile **0.3.0**; available capabilities also depend on the desktop version.

This differs from [importing model configuration](desktop-sync.md). Imported configuration lets the phone call models itself. Remote conversations use the computer's agents, models, tools, and workspaces. Desktop history is not merged into local mobile conversations.

## Connect and select a computer

1. Keep Desktop running and both devices on a mutually reachable network. Use the same local network for initial setup.
2. Display the pairing QR code in Desktop's **Device connections**.
3. Open **Settings → Device connections** on mobile and scan it, or use the available manual-entry option.
4. Complete the prompts on both devices and allow desktop agent access. Configuration-sync permission alone does not grant access to remote conversations.
5. Open the mobile sidebar and select the computer from the device selector at the top.

Update Desktop if prompted. Sleep, a closed desktop app, network isolation, or revoked permission can prevent access.

## Start or continue a task

1. Choose a desktop agent and open an existing conversation or create one.
2. When creating a conversation, select a workspace offered by the computer. **Default PC workspace** appears only when supported by Desktop.
3. Give a clear task, such as “Read this workspace's project notes and list action items. Do not edit files yet.”
4. Follow replies, tool results, and status. Respond to approvals and questions when needed.

Agents, models, tools, and workspaces are configured on the computer. Switching back to **This device** uses mobile's own agents and data. Mobile folder workspaces are described in [File library and shared workspaces](file-library.md); they are not the same directories as desktop workspaces.

## Send images and files

In a remote conversation that supports attachments, use **＋** beside the composer to add images or files, then describe your task. A file-only message is also supported.

* Remote transfer currently allows up to 8 files per message, 1 GB per file, and 2 GB combined.
* Follow preparation, upload, and completion states. Cancel uploads, retry failures, or resume after reconnection. Eligible uploads can recover after reopening the app.
* Upload completion does not prove the model understood the file. Desktop model capabilities, document parsing, and workspace permissions still apply.
* If no attachment action appears, check Desktop's version and advertised capabilities.

These are remote-transfer limits. Local chat limits for images, text, and documents are in [Chat and files](chat-and-files.md).

## Disconnects, backgrounding, and failed sends

**Disconnecting the phone does not automatically stop a task already running on the computer.** Returning to the foreground attempts reconnection and reloads the latest state. To stop a task, use the conversation's stop action and confirm the result.

For an undelivered message, read its status and reason before resending or discarding. If delivery is uncertain, reconnect and check the computer before repeating an operation that may already have started.

| Situation | What to check |
| --- | --- |
| Computer not found or connection fails | Desktop running, reachable address, local-network permission, firewall, and proxy; follow device-detail checks or address guidance |
| Pairing needs repair | Scan a current desktop pairing code |
| Configuration sync works but agents are unavailable | Desktop support and the separate agent-access permission |
| No agents or usable model | Create/configure an agent and select a usable model on Desktop |
| A resolved approval still appears on mobile | Wait for state synchronization instead of submitting it again |

Remote access is not cloud backup. A [mobile full backup](backup-and-restore.md) does not back up the computer. Revoke access by removing the phone's authorization in Desktop's Device connections.
