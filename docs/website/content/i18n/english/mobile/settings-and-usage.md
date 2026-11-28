---
icon: settings
---

# Settings, usage, and background replies

Open Settings from the sidebar for reading, models, voice, permissions, and local data. Backups, DeepSeek import, and cache cleanup live under **Settings → Data**.

## Theme, language, and text size

Use **Settings → General** for theme, app language, font size, share watermark, and document parser. App and documentation language are separate. Watermarks affect future sharing; local Save is unwatermarked. See [sharing](sharing-and-export.md).

General also includes:

| Option | Effect |
| --- | --- |
| Send on Enter | Changes keyboard sending behavior; follow its description |
| Multi-model reply cards | Changes card/standard presentation without rewriting content |
| Branch conversation tree view | Switches tree/flat recent-activity presentation; enabled by default and does not merge branches |
| Automatically collapse process | Changes reading presentation of thinking/tool activity without deleting records |
| Keep screen awake while generating | Attempts to keep the foreground screen awake; off by default and does not extend background execution |

Changes save through their respective actions; retry failures. See [conversation branches](conversation-branches.md) for actual use.

## Default and drawing models

Set default text, drawing, and translation models separately in **Settings → Default model**. Unset translation falls back to the default text model; see [translation](translation.md).

The page also provides automatic naming and a naming-model choice. Naming determines conversation titles rather than replacing the agent's answering model. The chosen model must still be authorized for its purpose.

Existing agents retain their models when global defaults change. Organization spaces may constrain choices/edits. For an empty list, check the current account, provider, and loading state; see [accounts and organizations](accounts-and-organizations.md).

## Understand usage

Open **AI usage** from Settings or the home usage entry. Explore overview, distribution, performance, and history with time/provider/model filters. Individual replies also expose input/output, requests, duration, and cost.

A **token** measures model content, not words. History, thinking, tool round trips, and parallel answers can all consume usage.

* Provider-reported amounts differ from configured-price estimates; follow the labels.
* Missing pricing means incomplete estimates, not free calls.
* Deleting chats does not refund charges. Regeneration and additional models make new requests.
* Local usage is not a third-party account's complete balance or official bill.

Community CherryAI plan/quota data comes from the account service separately from local usage. Sending depends on actual entitlement/admission checks, not a previously displayed sidebar balance.

## Continue after leaving the app

Use **Settings → Notifications** to inspect execution status and system limits:

| Item | Purpose |
| --- | --- |
| Background running | Displays execution-protection and power restrictions |
| Android battery/vendor settings | Opens system battery, autostart, and background controls where provided by the device |
| iPhone/iPad Live Activity | Controls lock-screen/Dynamic Island status display, **not background execution** |
| Reply completion notifications | Notifies background completion where OS permission allows |

Supported devices prefer system continued processing. Alternative fallback methods require explicit consent where offered. First-use or task prompts may require reading background guidance; dismissing a notice, status card, or notification is not task cancellation.

OS notification permission and app preferences are separate. Live Activities mainly appear away from the task; completing a task already being viewed is generally quiet. Task notifications return to its content.

## Why did locking the screen interrupt generation?

System duration, power, network, and process limits mean **continuous execution is not guaranteed**. Live Activity only displays state, and keeping the foreground screen awake does not extend locked-screen execution. Keep lengthy work in the foreground where possible.

Connection failures may show retries, and queued inputs can recover after reopening. If the OS ends the app, rely on saved content. Inspect the reply, queue, and approvals before resending to avoid duplicate work or charges.

Computer tasks do not automatically stop when the phone disconnects; see [desktop agents](remote-chat.md). [Background read-aloud](voice.md) is separately controlled by the system and does not establish successful generation.

## Parsing, backups, and feedback

* **Settings → General → Document parser:** changes subsequent reads; see [Chat and files](chat-and-files.md).
* **Settings → Data → Backup and restore:** exports a full archive or replaces data; see [backup](backup-and-restore.md).
* **Settings → Data → Import from DeepSeek:** imports an official export download link without replacing current conversations; see [import](deepseek-import.md).
* **Settings → Data → Clear conversation runtime cache:** finish running/queued work first and confirm. Chat history/files remain; old conversations rebuild working context and the next reply can take longer. This does not clear chat history.
* **Settings → Voice:** separately configures dictation, transcription, and read-aloud; see [voice](voice.md).
* **Settings → About us:** version, feedback, and history; failure surfaces also offer [diagnosis](diagnostics.md).

## Privacy and permissions

**Privacy** controls anonymous usage/error reports; **System permissions** controls device access; **Accounts and organizations** controls identity and data space. They do not replace one another. See [data and privacy](data-privacy.md).
