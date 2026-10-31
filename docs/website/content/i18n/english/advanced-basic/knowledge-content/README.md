---
description: Knowledge base, notes, drawing, and translation
icon: brain
---
# Knowledge and Content Workflow

Knowledge bases, notes, painting, and translation are not isolated tools. They handle organizing materials, refining content, creating visual assets, and processing multilingual files, respectively, and all can be passed to an Agent for further use.

<figure><img src="../../../../assets/58e56b2ba6cf637b831f0efb.webp" alt="Flowchart of materials entering the knowledge base, passing recall tests, being handed to the Agent, and forming text, images, or translations"><figcaption><p>Start by running recall tests with real questions, then have the Agent create reports, translations, or images based on the materials. </p></figcaption></figure>

## How the Four Entry Points Divide the Work

| Entry Point | Best For | Common Next Steps |
| ----- | ---------------------- | -------------- |
| [Knowledge Base] | Making materials retrievable by question | Bind to a chat assistant or Agent |
| [Notes] | Writing, organizing, and maintaining Markdown content long-term | Export documents or add to a knowledge base |
| [Painting] | Generating, editing, merging, and enhancing images | Download, or use in content tasks |
| [Translation] | Processing text, images, and documents | Save results, reuse history, or continue editing |

{% hint style="success" %}
If the goal is to "complete a deliverable using these materials," tell the Agent directly in [Work] where the materials are and what output is needed. Enter the specific module only when you need to manually organize the database, adjust images, or verify translations paragraph by paragraph.
{% endhint %}

<figure><img src="../../../../assets/27c5374d7b45598dca0744d9.webp" alt="The New Knowledge Base dialog with Name and Embedding Model fields"><figcaption><p>When creating a new knowledge base, name it first, then select the embedding model for retrieval. </p></figcaption></figure>

## From Materials to Deliverables

{% stepper %}
{% step %}
### 1. Organize Sources First

Add long-term reference materials to the knowledge base, and keep drafts being edited in Notes or the Work directory. Do not import all unconfirmed temporary chats into the knowledge base.
{% endstep %}

{% step %}
### 2. Verify Key Information Retrieval

Use recall tests in the knowledge base to ensure real questions find the correct snippets. If retrieval fails, fix the materials and settings first; do not let the Agent guess.
{% endstep %}

{% step %}
### 3. Create Text, Translations, and Images

Have the Agent draft content based on the materials; refine images and translations in [Painting] and [Translation], respectively. Finally, a human should check facts and expression.
{% endstep %}
{% endstepper %}

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Building Knowledge Bases and Recall Tests</strong></td><td>From Importing Materials to Verifying Retrieval</td><td><a href="knowledge-base.md">knowledge-base.md</a></td></tr><tr><td><strong>Notes, Knowledge Bases, and Agents</strong></td><td>Ensuring Smooth Flow of Drafts, Materials, and Tasks</td><td><a href="notes-knowledge-agent.md">notes-knowledge-agent.md</a></td></tr><tr><td><strong>Image Generation, Editing, and Enhancement</strong></td><td>Creating Usable Images from Templates</td><td><a href="painting-workflow.md">painting-workflow.md</a></td></tr><tr><td><strong>Translating Files, Images, and Long Text</strong></td><td>Handling Different Formats and Reusing Historical Results</td><td><a href="translation-workflow.md">translation-workflow.md</a></td></tr></tbody></table>
