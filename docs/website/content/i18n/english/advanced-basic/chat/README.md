---
description: Multi-model, long conversations, and deliverables
icon: comments
---
# Advanced Chat

**Chat** is designed for organizing thoughts while you interact. Beyond single-model Q&A, you can compare multiple models side-by-side, manage long conversation contexts, and continue using files, images, code, and citations from replies as artifacts.

{% hint style="info" %}
If a task requires continuous local file read/write, multiple tool calls, or long-running execution, use the Agent in **Work** instead. Chat is better suited for discussion, comparison, and finalizing drafts, while Agent is better suited for execution.
{% endhint %}

<figure><img src="../../../../assets/90f403b5989c5c90a6717d56.webp" alt="The selection flowchart in Advanced Conversation from complete questions to comparison and deliverables"><figcaption><p>Write your question and output requirements completely first; add model comparison or message branches only when cross-validation is needed. </p></figcaption></figure>

## Choose Capabilities by Goal

| Goal | Recommended Approach |
| ------------- | --------------------- |
| Compare perspectives from different models | Select multiple models in the input area and send the same question |
| Continue a very long discussion | Check context usage; summarize and start a new topic if necessary |
| Queue the next question for later | Use the message queue to avoid interrupting the current reply |
| Continue processing files or code in a reply | Open the artifact preview, then download, copy, or continue in a new task |

<figure><img src="../../../../assets/7eea2d9eab50983603d6641b.webp" alt="The model selector with a search box, a Multi-select button and a model list"><figcaption><p>The model selector allows you to choose one or more models for the same question. </p></figcaption></figure>

## Recommended Order

{% stepper %}
{% step %}
### 1. Write the Question Completely

Specify the goal, materials, constraints, and desired output format. Multiple models only amplify differences in the original question; they do not automatically fill in missing information.
{% endstep %}

{% step %}
### 2. Decide Whether Comparison Is Needed

Select multiple models only when you need different perspectives. For daily Q&A, stick to a single model for a clearer interface and easier usage control.
{% endstep %}

{% step %}
### 3. Consolidate Valid Conclusions

Save reusable materials to notes or the knowledge base; hand off work that requires further execution to the Agent, attaching the confirmed conclusions.
{% endstep %}
{% endstepper %}

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Multi-Model Comparison </strong></td><td>Ask several models the same question and compare their answers </td><td><a href="model-compare-branches.md">model-compare-branches.md </a></td></tr><tr><td><strong>Long Conversations, Context, and Queued Messages </strong></td><td>Keep long conversations clear and controllable </td><td><a href="context-queue.md">context-queue.md </a></td></tr><tr><td><strong>Artifacts, Citations, and Export </strong></td><td>Review and take away truly useful results </td><td><a href="artifacts-export.md">artifacts-export.md </a></td></tr></tbody></table>
