---
description: Data Settings → Obsidian Configuration
icon: gem
---
# Obsidian Configuration Tutorial

Cherry Studio supports integration with Obsidian, allowing you to export full conversations or single conversation entries to your Obsidian vault.

{% hint style="warning" %}
This process does not require installing additional Obsidian plugins. However, since Cherry Studio's import to Obsidian works similarly to Obsidian Web Clipper, it is recommended that users upgrade Obsidian to the latest version (current Obsidian version should be at least greater than **1.7.2**), to avoid [import failures if the conversation is too long](https://github.com/obsidianmd/obsidian-clipper/releases/tag/0.7.0).
{% endhint %}

### Step One: Configure Cherry Studio

Open Cherry Studio's _Settings_ → _Data Settings_ → _Obsidian Settings_ menu. The dropdown box will automatically display the names of Obsidian vaults opened on this machine. Select your target Obsidian vault:

### Step Two: Export Conversation

<a id="dao-chu-wan-zheng-dui-hua"></a>

#### Export Full Conversation

Return to Cherry Studio's conversation interface, right-click on the conversation, select _Export_, and click _Export to Obsidian_:

At this point, a window will pop up, allowing you to adjust the **Properties** of the conversation note to be exported to Obsidian, the **folder location** within Obsidian, and the **processing method** for exporting to Obsidian:

*   **Vault**: Click the dropdown menu to select other Obsidian vaults
*   **Path**: Click the dropdown menu to select the folder for storing the exported conversation notes
*   As Obsidian note properties (Properties):
    *   Tags (tags)
    *   Created time (created)
    *   Source (source)
*   There are three available **processing methods** for exporting to Obsidian:
    *   **Create new (overwrite if exists)**: Create a new conversation note in the `folder` specified in the **Path**. If a note with the same name exists, it will overwrite the old note.
    *   **Prepend**: If a note with the same name already exists, export the selected conversation content and add it to the beginning of that note.
    *   **Append**: If a note with the same name already exists, export the selected conversation content and add it to the end of that note.

{% hint style="info" %}
Only the first method includes Properties, while the latter two methods do not.
{% endhint %}

After selecting all options, click OK to export the full conversation to the corresponding Obsidian vault's folder.

#### Export Single Conversation Entry

For exporting a single conversation entry, click the menu below the message, select _Export_, and click _Export to Obsidian_:

<figure><img src="../../../assets/302fb7423ac66c93c8df8e03.webp" alt="The message menu with Export expanded and Export to Obsidian highlighted"><figcaption><p>Export a single message from the menu under it</p></figcaption></figure>

A window similar to the one for exporting a full conversation will then appear, asking you to configure the **note properties** and **note processing method**. Follow the [tutorial above](obsidian.md#dao-chu-wan-zheng-dui-hua) to complete it.

### Export Successful

🎉 Congratulations! You have now completed all configurations for Cherry Studio to integrate with Obsidian and have successfully gone through the export process. Enjoy yourselves!
