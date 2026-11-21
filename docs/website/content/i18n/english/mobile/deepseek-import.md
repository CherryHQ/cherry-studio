---
icon: download
---

# Import DeepSeek conversations

Import readable conversations from an official DeepSeek export for reading and continued discussion. This does not sign in to DeepSeek or automatically configure a DeepSeek model provider.

## Get the export download link

Use DeepSeek's data export feature and obtain the ZIP archive's **complete download URL**. Copy the actual download address with all parameters. An ordinary webpage, single-conversation share link, or local file path is not a substitute.

The link may contain time-limited access credentials. Do not post it in public feedback or chat. Obtain a fresh link from DeepSeek when it expires.

## Import in the app

1. Open **Settings → Data → Import from DeepSeek**.
2. Paste the complete address into **DeepSeek export download link**.
3. Use the keyboard's **Go** action and wait for download, reading, and import progress.
4. On success, open the newly created **DeepSeek** agent and inspect counts, titles, branches, and available attachments.
5. Select a usable model before continuing a conversation; configure one through [providers and models](providers-and-models.md) if needed.

Existing agents and conversations remain. **Every successful import creates a new DeepSeek agent**; repeated imports do not merge or deduplicate automatically. It can inherit an existing default model, which is not necessarily a DeepSeek model.

## What history is retained?

Readable messages, titles, timestamps, and branches are preserved where possible. Only images actually present and importable become attachments. Missing or unsupported originals can retain a name/description and cause a partial-import notice.

Historical search and webpage links become source references rather than replayed tool actions. Missing billing or runtime state is not invented. A successful import cannot establish that the original service included everything in its export.

## Failure or leaving the page

* **Expired link/download failure:** get a new official download URL and check the network.
* **Partially damaged content:** readable conversations/fragments may still import. Inspect skipped/missing-content notices rather than treating partial success as full recovery.
* **Structurally damaged ZIP, unsupported format, or no readable messages:** export again from DeepSeek.
* **Size/storage limits or another data operation:** resolve the reported cause before retrying. Do not run backup creation/restore simultaneously.

Leaving the page cancels the operation. There is no background download or process-death resume. Failure or cancellation does not replace existing conversations. Check for a completed result before starting over.
