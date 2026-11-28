---
icon: circle-help
---

# Troubleshooting

For connection problems, start with a short message without attachments to narrow down the cause.

## Why cannot I chat immediately after installation?

Choose a model available to the current identity. Your own providers need credentials, models, and enablement; entitled community accounts use authorized CherryAI models, while organizations supply their own catalogs. App sign-in does not grant every third-party API credits. See [accounts](accounts-and-organizations.md), [desktop import](desktop-sync.md), and [quick start](quick-start.md).

A platform's consumer chat subscription may not include API credits for other apps; check with the platform.

## My provider exists, but the model picker is empty

Check provider/model enablement, model purpose, and filters. Embedding/reranking entries are not ordinary chat models. Text/image pickers may show different models. Return to All and wait for the first model-information download.

If no model is added, [synchronize or add manually](model-management.md).

## Will model updates overwrite keys or custom settings?

Model information updates do not change provider addresses/keys or rewrite saved model overrides. Default fields can inherit new information.

**Desktop provider synchronization does replace selected provider addresses and keys.** See [model updates](model-updates.md) and [desktop import](desktop-sync.md).

## Synchronization fails, but chat works

The model-list API is separate from chat, and a platform may support only the latter. Add its exact model ID manually and check the connection. Failed discovery does not clear existing models.

Not returned does not necessarily mean discontinued; see [model synchronization](model-updates.md).

## What do connection errors mean?

| Error | Check first |
| --- | --- |
| 401 / Unauthorized | Complete, valid, saved, enabled key |
| 403 / Forbidden | Account, region, model, or organization access |
| 404 / Not found | Base address, API, exact model ID, duplicated request paths |
| 429 / Too many requests | Rate limits and credits; wait rather than repeatedly sending |
| Network failure / Timeout | Provider reachability, proxy, and service status |
| Context/request too large | Reduce attachments/history or choose a suitable model; raising configured limits alone does not help |

Providers can use different codes. Read the error detail and platform instructions. See [provider setup](providers-and-models.md).

## Why did a changed setting not take effect?

* Existing provider addresses and key switches save directly; a key-editing sheet has its own Save. New provider creation and model creation/editing use their continue/add/save actions.
* Existing-agent edits, global model selection, and API selection in model lists save automatically; look for failure notices.
* Complete key-editing sheets and resolve saving errors before checking or synchronizing.
* A global default-model change does not update every existing agent.

See [model management](model-management.md) and [agent editing](agents-and-tools.md).

## Why cannot I delete a model?

A global default must be changed or cleared in **Settings → Default model** first. Deleting another model used by an agent means choosing a replacement for that agent.

## I can preview an image, but cannot send it

Preview differs from model input. Use a vision model for visual understanding; supported devices can provide local OCR text to a text-only model. Inspect recognition errors where needed. The per-image limit is now 30 MiB, still subject to model/provider limits; capability flags cannot override them.

See [chat and files](chat-and-files.md) for scanned PDFs, empty document text, and large attachments.

## Where are the web-search switch and Plugins button?

Old agent built-in capability switches have been removed, and there is no separate composer web switch. Standard uses configured model/service routes; Minimal only supports available native model web access. Plugins/skills require Standard and usable connections/bindings; ＋ → Plugins can still offer connection setup when none is connected.

Connected plugins can be used directly, or named through **＋ → Plugins**. See [web search](web-search.md) and [plugin connections](plugins.md).

## Plugin authorization keeps waiting

Return to Cherry Studio, check status, and confirm the account/workspace. Reopen authorization or check again; restart an expired request. Missing organization permissions must be handled at the service.

DingTalk actions need requesting again after additional authorization. WeCom links must be opened in WeCom before expiry. See [plugins](plugins.md).

## Why can I only retry the latest answer?

Current versions retain several answer paths instead of only replacing one answer. Availability follows execution state/message type; regenerate, add a model, or edit a sent question into a branch where offered. Check the installed version for older UI. Retrying/deleting does not undo external effects; see [models and branches](conversation-branches.md).

## Does context compaction delete my conversation?

Visible history remains. Earlier material is summarized for the model and some original detail may be absent. Supply key material again when exactness matters. See [long conversations](chat-and-files.md).

## Why are exported images split, and code incomplete?

Current chat images use one height-bounded card, truncating long text/tables/code with an ellipsis, without the old paged/long-image switch. Choose HTML/Markdown for complete content. Image groups/HTML conversions can have several previews; check the source. Failure retains the selected format and offers retry rather than falling back.

See [sharing and export](sharing-and-export.md) for selection, watermarks, excluded process content, and files.

## Background generation stops or notifications are missing

Check **Settings → Notifications** and system permission. The OS can still restrict background work. Inspect the conversation/drawing before retrying. See [background replies](settings-and-usage.md).

## Does pairing automatically synchronize chat history?

Local and desktop histories do not merge automatically. Configuration import copies providers and models; switching to the computer lets you [use remote agent conversations](remote-chat.md), whose history remains on Desktop. Use [Backup and restore](backup-and-restore.md) before changing phones.

## Android blocks installation or TestFlight cannot join

Use the [official download page](https://cherryai.com/download?platform=mobile) and install from Google Play or the App Store first. For APKs, Android may need permission for the downloading app to install APKs. For beta builds on iPhone/iPad, install TestFlight before opening its invitation. TestFlight capacity, build expiry, and service availability can affect beta installation.

See [download and installation](installation.md).

## Tools do not run, or a file was not saved

* A model only answers in text, waits for approval, or reports missing permission: check mode, model tool support, connections, bindings, and permissions in [Let AI Use Tools](using-tools.md).
* Android opens the calendar app, or an event write has an uncertain outcome: follow [Calendar and Reminders](calendar-and-reminders.md) and inspect existing records before retrying.
* Location fails, or Health data is empty or partial: see [Location and Health Records](location-and-health.md). An empty result does not prove that no records exist.
* You get a code block without a saved file, or edits leave the original unchanged: see [Create and Edit Files](file-generation.md).
* You have HTML but want a PPT, or cannot edit the PPT's text individually: see [HTML to Image and PPT](html-export.md).

## Missing new features or unexpected results

| Problem | Where to start |
| --- | --- |
| Installed skill is not used | Check Standard mode, agent binding, and required tools in [Skills](skills.md) |
| File missing or deletion was accidental | Open Recently deleted in Files; conversation deletion is separate. See [File library](file-library.md) |
| New chat cannot read project files | Associate the same workspace folder or attach the material again; changing workspaces does not move earlier files |
| Backup is busy, incompatible, or out of space | Finish tasks, check the source archive and free space; see [Backup and restore](backup-and-restore.md) |
| No translation action or saved result | Only completed local text replies qualify; check the model. Incomplete translations are not saved. See [Translation](translation.md) |
| MCP has no interactive view or prompt | Check server capabilities, connection, and agent binding in [Plugins](plugins.md) |
| Follow-ups continue after a failed reply | Inspect the queue and remove unwanted waiting inputs; leaving the screen does not cancel them |
| An older package lacks voice, SSH, or new features | Install the complete update; code alone cannot add every native capability. See [installation](installation.md) |
| Chats disappear after account switching | Check the personal/organization space; histories do not merge. See [accounts](accounts-and-organizations.md) |
| DeepSeek link expired or import is partial | Get a fresh export link and inspect skipped content. See [import](deepseek-import.md) |
| Missing desktop scheduled-task results | Select that computer's Scheduled tasks with a supported desktop version. See [desktop agents](remote-chat.md) |

## Check first, then optionally analyze with AI

Choose **Troubleshoot** from chat/painting error details. Local checks cover relevant configuration, endpoint reachability, and runtime state; a responding address does not establish valid authentication or inference. Redacted errors/check context go to AI only after choosing a diagnostic model and explicitly starting, which can incur model charges.

Check conclusions against evidence and recheck after configuration changes. Feedback submission is separate; see [checks and AI diagnosis](diagnostics.md).

## How do I report an unresolved issue?

Open **Settings → About us → Feedback**, describe reproduction steps and expected/actual results, then submit. The app attaches error/request summaries and system information from the last 24 hours. Copy the report ID after success and follow its progress in **Feedback history**.

Shake feedback is off by default. When enabled, shaking in the foreground captures the page and opens the form. A screenshot uploads only when selected for that submission; inspect it for private content. Removing local history does not withdraw a submitted report.

You can also report app/device versions, steps, and error details in the [App repository Issues](https://github.com/CherryHQ/cherry-studio-app/issues). Do not publish keys, private conversations, or full backups. See [Privacy](data-privacy.md) for data scope.
