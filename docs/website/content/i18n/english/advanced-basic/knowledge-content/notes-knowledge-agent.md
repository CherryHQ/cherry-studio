---
icon: note-sticky
---
# Notes, Knowledge Base, and Agent

Notes, knowledge bases and Agents each do one part of the job: Notes is where you write and maintain content, a knowledge base makes that content searchable, and an Agent uses it to answer questions or produce deliverables. Connecting them lets your own writing become the source the Agent works from.

## Which One to Use

| You want to | Use |
| --- | --- |
| Draft, edit, and keep Markdown content | [Notes](../../cherrystudio/preview/notes.md) |
| Let questions find the right passages in many documents | [Knowledge Base](../../knowledge-base/knowledge-base.md) |
| Run multi-step work on that content, such as research or writing a report | [Agent](../agent.md) |
| Use a single note in one conversation | **Reference Note** in the chat input, without a knowledge base |

## From Notes to an Agent

{% stepper %}
{% step %}
### 1. Write and Organize in Notes

Keep one topic per note and use clear headings, so passages make sense on their own when they are retrieved later.
{% endstep %}

{% step %}
### 2. Send the Notes to a Knowledge Base

Right-click a note in the Notes list and choose **Export notes to knowledge base**, then pick the target knowledge base. You can also add notes from the knowledge base with **Add Data Source → Note**.
{% endstep %}

{% step %}
### 3. Check Retrieval

When the note shows **Ready** in the knowledge base, open **Recall Test** and ask a few real questions to confirm the right passages come back.
{% endstep %}

{% step %}
### 4. Link the Knowledge Base to an Agent

In **Edit Agent → Knowledge**, click **Add knowledge base** and select it. Make sure **Knowledge Search** is on in **Built-in tools**. See [Using with Agent](../../knowledge-base/agent.md).
{% endstep %}

{% step %}
### 5. Bring Results Back to Notes

When the Agent produces something worth keeping, save it as a note and keep editing it there. If it becomes long-term reference material, send it to the knowledge base again.
{% endstep %}
{% endstepper %}

{% hint style="warning" %}
A note sent to a knowledge base is a snapshot. Later edits in Notes do not update the knowledge base automatically; send the note again or reprocess it after important changes.
{% endhint %}

<details>

<summary>Are changes to notes added to the knowledge base synced immediately?</summary>

No. First, check the data status in the knowledge base. If the content has changed but the retrieval results have not updated, reprocess the corresponding materials and run a recall test again.

</details>

<details>

<summary>Should every note go into a knowledge base?</summary>

No. Add finished, long-term reference material. Drafts and temporary notes are better left in Notes, where they don't compete with confirmed content in search results.

</details>
