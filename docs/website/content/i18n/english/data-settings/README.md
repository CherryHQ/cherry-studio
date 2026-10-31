---
icon: floppy-disk
---

# Data Settings

Data Settings is Cherry Studio's **data hub**: everything to do with **backup, restore, syncing across devices, and third-party note app integrations** lives here.

> In short: **if you're worried about losing data, set it up here once.**

## Which Backup Option Should I Use?

| Your situation | Recommended option |
| --------------------------- | ----------------------------------------------------------------- |
| Single computer, worried about disk failure | [WebDAV backup](WebDAV.md) |
| Want to sync conversations / assistants across several computers | [WebDAV backup](WebDAV.md) — back up on computer A, restore on computer B |
| Already have S3-compatible storage such as AWS or Alibaba Cloud OSS | [S3-compatible storage backup](s3-compatible.md) |
| Want to archive conversations to a note app automatically | [Notion](notion.md) / [Obsidian](obsidian.md) |
| Just want to back up to another local folder or an external drive | **Local backup** (choose a backup folder; supports automatic backups and backup file management) |

## What Gets Backed Up?

**Full backup by default**:

* Conversation history and topics
* Assistants and preset settings
* Knowledge bases (including vector database content)
* Notes, paintings, files and other attachments
* Preferences and personalization settings
* Provider configuration (API keys are included too)

**Lite backup** (optional): the backup screen has a **Lite backup** switch. When it's on, **image, knowledge base and other data files are skipped and only chat history and settings are backed up** — smaller and faster, good for frequent quick backups.

{% hint style="warning" %}
Backup files contain sensitive information such as provider API keys. **Don't share backup files with others, and don't store them on untrusted shared drives.**
{% endhint %}

## How Often Should I Back Up?

* **Manual backup**: click **Backup** at any time
* **Automatic backup**: once turned on, runs at the **interval** you set (from a few minutes up to 24 hours, e.g. 5 minutes / 30 minutes / 1 hour / 24 hours) rather than a fixed "daily / weekly" schedule

## Where Is the Data Stored?

To move it to another drive, see [Change Storage Location](../personalization-settings/storage.md).

## Import ChatGPT or Claude Conversations

Path: **Settings → Data → Import External App Data**. Choose **Import ChatGPT Data** or **Import Claude Data**, then select `conversations.json` as prompted.

To export from Claude:

1. Log in to Claude and open **Settings → Privacy → Export data**;
2. Wait for the email and download the export file;
3. Unzip it and select the `conversations.json` inside.

Claude data is imported with text, thinking, tool calls and tool results; available branches in ChatGPT and Claude conversations are kept as well. Images and attachments are not imported.

## Clear Cache by Category

Path: **Settings → Data → Clear Cache**. The dialog calculates the size of each category separately; if the count isn't finished or can only be estimated, go by what the page says.

| Category | What gets cleared | Effect |
| ----------- | ---------------------- | --------------------- |
| **App cache** | Cache and temporary files created while the app runs | Chat history and settings are not deleted |
| **Website and Mini App data** | Cookies and site storage | Websites or Mini Apps may require you to log in again |
| **Leftover files and knowledge bases** | Unused files, knowledge base leftovers and temporary files from backup restores | Only clears leftovers the system identifies |
| **V1 legacy data** | Old V1 conversations and settings kept on this computer | Permanently deleted, cannot be recovered |

{% hint style="danger" %}
**V1 legacy data** only appears when retained V1 data is detected. Selecting it deletes the V1 data source needed for **Re-migrate**. **Don't select this item** until you've confirmed the V1 data was fully migrated and you've kept a full backup plus the V1 data folder. Unless you're fixing a failed V1 migration, regular users shouldn't use **Re-migrate** either. See [V2 Breaking Update Notice](../cherry-studio/installation/v2-breaking-update-notice.md).
{% endhint %}

## Reset App Data

**Reset Data** clears chats, assistants, knowledge bases, files and settings, then restarts the app. It cannot be undone and is not a routine troubleshooting step; create a full backup before doing it.

The Data Settings page also offers **Export Menu Settings**, which controls where conversations or notes can be exported to.

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature suggestions during configuration or use, please use the official channels listed in [Feedback and Suggestions](../question-contact/suggestions.md).
