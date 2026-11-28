---
icon: terminal
---

# SSH remote servers

SSH authenticates a direct connection to a configured server for file browsing, previews, transfers, and agent-run commands. It is separate from [Cherry Studio desktop agents](remote-chat.md) and [remote desktop](remote-desktop.md).

## Save a connection

1. Open **Plugins** and add an entry in **SSH connections**.
2. Enter its name, server hostname/IP, port, and username. The default port is 22; use the server's actual setting.
3. Choose password or private-key authentication and enter credentials in their dedicated fields, including a key passphrase if required.
4. Save and check the connection. Verify the server fingerprint before first trust; investigate changes if the server/key was not intentionally replaced.

A server may request additional authentication in a dedicated dialog. Enter passwords, private keys, and codes there rather than in chat. Authentication answers do not become agent input or transcript tool results.

Saving configuration does not establish connectivity. The phone network, SSH service, port, and account access must work; localhost on the phone means the phone itself.

## Browse, preview, and transfer files

Open a saved connection and browse its directories. Preview supported files; for uploads choose a local source, and for downloads check the remote path and local destination.

Previewing is not proof that a complete file has been retained in the library. Check the reported destination after transfer. Server changes are not undone by closing preview or deleting a chat.

## Use a server in chat

1. Select Standard mode and a tool-capable text model.
2. Choose a saved connection through **＋ → SSH** to insert its reference.
3. Specify paths, scope, and outcome. For example:

> Read README in this server's current directory and summarize startup steps. Do not run commands or edit files.

> List recently modified files in /var/log. Report the result without deleting anything.

Selecting a connection alone executes nothing. For commands, transfers, or writes, identify the target and inspect the host, account, command, working directory, and input in approval.

## Approvals and limited diagnostic access

SSH retains separate approvals; ordinary automatic approval does not bypass them. A command approval may offer a one-hour diagnostic grant for this conversation and connection. It covers only a restricted set of simple diagnostic commands, not arbitrary scripts, composed commands, path operations, or writes. Expiration or a different conversation/connection requires fresh handling.

Follow actual approvals and outcomes for changes, restarts, or deletion. After cancellation or disconnection, an operation may already have started. Check before retrying to avoid duplicates.

## After restoring or changing servers

[Backups](backup-and-restore.md) retain connection configuration but **exclude passwords, private keys, and passphrases**. Re-enter credentials after restoring and recheck host trust, accounts, and paths.

Use connection diagnostics and errors to distinguish network, host trust, authentication, path, and filesystem-permission failures.
