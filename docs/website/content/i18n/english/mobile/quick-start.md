---
icon: rocket
---

# Quick start

Prepare one working model and get a simple response before adding files, skills, or other tools.

## 1. Choose how to configure

A fresh installation walks through welcome, privacy, device permissions, notification/background guidance, accounts, and model preparation. Permissions and sign-in can be skipped where offered and completed later. Existing configured installations do not restart the entire flow.

* **Use your own model service:** choose **Connect provider**, then follow steps 2–3.
* **Already configured on desktop:** choose **Sync from desktop**, [pair and import](desktop-sync.md), then choose a model.
* **Have an eligible community subscription account:** sign in and choose from models granted by the account. Do not recreate its managed service as an ordinary API-key provider.
* **Use an organization or private deployment:** follow [accounts and organization spaces](accounts-and-organizations.md) and use its supplied models and agents.

A loading or failed account/model lookup does not prove that no entitlement exists. Wait or retry. You may skip preparation and configure **Settings → Model service** later, but must choose a usable model before making a model request.

## 2. Enter and save a key

Enter the provider's **API key**, or use the sign-in method actually offered on that provider's page. For a custom provider, also check the base address and API format.

Continue through creation for a new provider. Existing providers save through their respective fields; a key-editing sheet still has its own **Save** action. Login passwords, consumer chat subscriptions, and API credits are different; follow the platform's actual support.

## 3. Add a model and enable the provider

Fetch the model list and select a text model, or add its exact model ID manually if discovery fails. Let initial model information finish preparing and ensure the provider is enabled.

Confirming a model during onboarding sets the default and opens chat; **it does not send a test message automatically**. Later, change it from the chat model picker or current agent's editor. Organization-managed catalogs may allow selection without editing. See [providers and models](providers-and-models.md).

## 4. Send a first message

Use the initial agent—named **Cherie** for newly initialized English data—select a model, and send:

> In three sentences, describe what you can help me do.

A response establishes that this request and model connection worked. If it fails, try a short message without attachments, use [checks and AI diagnosis](diagnostics.md) from the error details, or follow [troubleshooting](troubleshooting.md).

Open separate conversations with the same agent for different topics. Put lasting preferences in its instructions and one-off requirements in the message.

## What next?

| Task | Guide |
| --- | --- |
| Understand photos, summarize documents, or attach audio | [Chat and files](chat-and-files.md) |
| Compare models and preserve different discussion paths | [Multiple models and conversation branches](conversation-branches.md) |
| Dictate messages or listen to answers | [Voice and audio transcription](voice.md) |
| Install and reuse a task method | [Skills](skills.md) |
| Create editable Word, Excel, or PowerPoint files | [Create and Edit Files](file-generation.md) |
| Connect Feishu, Notion, or other services | [Plugins and external tools](plugins.md) |
| Continue desktop work or read scheduled-task results | [Desktop agents](remote-chat.md) |
| Bring in DeepSeek history | [Import DeepSeek conversations](deepseek-import.md) |
| Generate and revise pictures | [Image generation](image-generation.md) |
| Save or share selected messages | [Sharing and export](sharing-and-export.md) |
