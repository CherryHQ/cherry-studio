---
icon: square-n
---
# Notion Configuration Tutorial

Cherry Studio supports importing topics into Notion databases.

## Step One: Create a Connection

Open Notion's [Developer tools → Connections](https://app.notion.com/developers/connections) page and click **New connection**. You need to be an owner of the workspace you connect.

<figure><img src="../../../assets/b24e437220ae8f8f52113a15.webp" alt="The Connections tab of Notion Developer tools with a New connection button"><figcaption><p>Click New connection in Developer tools → Connections</p></figcaption></figure>

## Step Two: Fill in the Connection Details

* **Name**: Cherry Studio
* **Workspace**: the workspace that holds the database you want to export to
* **Icon** (optional): you can use this image

<figure><img src="../../../assets/9fde479e46e4ec0c6e510f34.webp" alt="" width="188"><figcaption></figcaption></figure>

## Step Three: Copy the API Token

Open the connection's **Configuration** tab, copy the **API token**, and paste it into Cherry Studio under **Settings → Data → Notion Settings**.

<figure><img src="../../../assets/403d206affac8f8d8be7a4a1.webp" alt=""><figcaption><p>Paste the token into the data settings</p></figcaption></figure>

## Step Four: Create a Database and Add the Connection

In [Notion](https://www.notion.so/), create a new page, choose **Database** as the page type, and name it Cherry Studio. Then click the **•••** menu at the top right of the page, choose **Add connections**, and select **Cherry Studio**. Cherry Studio can only write to pages that the connection has been added to.

## Step Five: Enter the Database ID

Open the database and copy its URL. If the URL looks like this:

`https://www.notion.so/<long_hash_1>?v=<long_hash_2>`

the database ID is the `<long_hash_1>` part. Enter it in Cherry Studio and click **Check**.

<figure><img src="../../../assets/0d1c1cd6f57ee46e461f1af1.webp" alt=""><figcaption><p>Enter the database ID and click Check</p></figcaption></figure>

## Step Six: Set the Title Field

Enter the **Page Title Field Name**: the name of the database's title column. For a new database it is `Name`.

<figure><img src="../../../assets/8ec3dea231ec68efc714e8c9.webp" alt=""><figcaption><p>Enter Page Title Field Name</p></figcaption></figure>

## Step Seven: Export

Congratulations, Notion configuration is complete ✅ You can now export Cherry Studio content to your Notion database.

<figure><img src="../../../assets/b87c95a415af296c5aee685f.webp" alt="The message menu with Export expanded and Export to Notion highlighted"><figcaption><p>Open the menu under a message, then choose Export → Export to Notion</p></figcaption></figure>

<figure><img src="../../../assets/a2f47f9cb8810a6160dda621.webp" alt=""><figcaption><p>View export result</p></figcaption></figure>