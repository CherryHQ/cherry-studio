---
icon: robot
---
# Using with Agent

Once a knowledge base is bound to an Agent, the Agent can search and read authorized materials during multi-step tasks. If updating materials is explicitly required, you can also enable knowledge base management.

{% hint style="info" %}
Standard chat is suitable for single-turn Q&A, while Agents are designed for continuous research, comparison, file generation, and step-by-step acceptance. Agents only access the knowledge bases bound in their configuration.
{% endhint %}

## Differences Between Standard Chat and Agent

| Standard Chat | Agent |
| ------------ | --------------- |
| Temporarily select knowledge base before each message | Long-term binding in Agent configuration |
| Suitable for instant Q&A and short comparisons | Suitable for multi-step research and file delivery |
| Primarily answers using recalled snippets | Can search materials and manage knowledge bases based on permissions |
| Current conversation determines material scope | Agent configuration determines accessible scope |

## Configuring a Read-Only Knowledge Base Agent

{% stepper %}
{% step %}
### 1. First, Validate the Knowledge Base

Ensure target materials are ready and complete recall testing with real questions. Agents cannot fix missing content or incorrect chunking.
{% endstep %}

{% step %}
### 2. Open the Agent Edit Window

Go to **Work**, select the target Agent, and open **Edit Agent** from the menu.
{% endstep %}

{% step %}
### 3. Bind the Minimum Necessary Knowledge Bases

Open the **Knowledge** tab and click **Add knowledge base** next to **Linked knowledge bases**. Only bind the libraries required for this task to avoid interference from cross-department or cross-version materials.

<figure><img src="../../../assets/1d2863fd1fb833e142bc1eac.webp" alt="The Knowledge tab of the Edit Agent dialog with Linked knowledge bases and an Add knowledge base button"><figcaption><p>Link knowledge bases to the Agent in Edit Agent → Knowledge</p></figcaption></figure>
{% endstep %}

{% step %}
### 4. Check the Knowledge Tools

After a knowledge base is linked, **Knowledge Search** and **Manage Knowledge** appear under **Built-in tools** (in the **Context** group). Keep **Knowledge Search** on. For read-only research, Q&A, summarization, and comparison, turn **Manage Knowledge** off.

<figure><img src="../../../assets/ff61dd935232699efc184495.webp" alt="The Built-in tools tab of Edit Agent with Knowledge Search and Manage Knowledge switches in the Context group"><figcaption><p>Knowledge Search and Manage Knowledge appear once a knowledge base is linked</p></figcaption></figure>
{% endstep %}

{% step %}
### 5. Test with Clearly Bounded Tasks

Require the Agent to list sources before providing conclusions. If materials do not support a claim, state this explicitly; do not allow filling gaps with common sense.
{% endstep %}

{% step %}
### 6. Accept Sources and Deliverables

Verify which knowledge base each conclusion comes from, ensure facts and recommendations in files are separated, and confirm that parts lacking evidence are marked.
{% endstep %}
{% endstepper %}

## How to Choose Between Built-in Tools, Knowledge Bases, Skills, and MCP

<figure><img src="../../../assets/9a40f1cd26f6618a31c73d42.webp" alt="A selection relationship diagram illustrating the respective purposes of Agent built-in tools, knowledge bases, skills, and MCP"><figcaption><p>Use knowledge bases for looking up materials, skills for repetitive methods, and MCP for accessing external systems. Do not use expanded permissions as a substitute for clear tasks. </p></figcaption></figure>

## Knowledge Search and Manage Knowledge

| Capability | What It Can Do | Suitable Tasks | Default Recommendation |
| ----- | -------------- | ----------- | ----------- |
| Knowledge Search | Search, list, and read bound knowledge bases | Q&A, research, summarization, comparison | Keep enabled |
| Manage Knowledge | Add, delete, or refresh knowledge base documents | Approved material maintenance | Turn off for read-only tasks; turn on only when needed |

{% hint style="warning" %}
Binding a knowledge base only grants access scope; it does not create a copy of the knowledge base. After materials are updated or re-indexed, the Agent will use the updated content in the next search.
{% endhint %}

{% hint style="danger" %}
After enabling **Manage Knowledge**, adding, deleting, or refreshing will modify materials or indexes. Before approval, confirm the target knowledge base, specific entries, conflict resolution for same-named items, and rollback plans.
{% endhint %}

## How Agent Configuration Works Together

<figure><img src="../../../assets/c14f75b2fe7b485cee989258.webp" alt="An architecture diagram showing how model division of labor, available capabilities, and security boundaries collectively affect Agent tasks and deliverables"><figcaption><p>The model determines understanding and generation, the knowledge base provides evidence, and permissions determine how far the Agent can execute. </p></figcaption></figure>

## Recommended Task Templates

### Research and Generate Report

> Find all regulations regarding overseas business trip approvals and insurance in the bound knowledge bases. First list sources and conflicts, then generate a Markdown checklist. Do not fill in content not supported by materials.

### Update FAQ

> Search existing entries for accommodation reimbursement and compare the latest policy with the old FAQ. First provide a list of proposed changes; refresh relevant documents only after approval.

### Multi-Knowledge Base Comparison

> Find evidence from the "Product Manual" and "After-Sales Cases" knowledge bases respectively. Organize into three columns: "Official Rules / Real Cases / Recommended Scripts". Keep the source name for each conclusion.

## Configuration Notes

| Configuration Item | Recommended Starting Point | When to Increase | Risk Control |
| ----- | ---------- | ------------ | ------------- |
| Bound Knowledge Bases | 1 task-related library | Only if cross-library comparison is needed | Clearly state the purpose of each library in the prompt |
| Knowledge Search | Enabled | Only if the task requires looking up materials | Verify sources are within the bound scope |
| Manage Knowledge | Disabled | Only if adding, deleting, or refreshing is explicitly needed | Approve item by item and back up important materials first |
| Output Requirements | Separate facts, inferences, and recommendations | When generating reports or files | Keep the source name for each fact |

## User Case

Xiao Lin bound **Official Manual** and **Review Cases** to the after-sales Agent, enabling only Knowledge Search. He required the Agent to list safety warnings, official steps, and case recommendations by device model, keeping the three separate. When old cases needed updating, he temporarily enabled the management tool, reviewed the proposed changes list, and then approved.

The acceptance criteria are: The Agent does not access unbound materials, does not present case recommendations as official rules, and all write operations have clear targets and acceptance results.

## Result Acceptance

* Sources only come from the knowledge bases bound to the current Agent.
* Search results cover every condition in the task.
* Deliverables separate material facts, Agent inferences, and recommendations.
* Management operations explain the target, impact, and result.
* Re-run fixed recall questions after updating materials.

## FAQ

<details>

<summary>Standard chat can find it, why can't the Agent? </summary>

Check if the target knowledge base is bound to the current Agent and if **Knowledge Search** is enabled. Binding scopes for different Agents do not inherit from each other.

</details>

<details>

<summary>When should Manage Knowledge be turned off? </summary>

For read-only research, team-shared policy libraries, and material libraries retaining historical versions, enable only Search by default. Enable Management temporarily and approve item by item when updates are needed.

</details>

<details>

<summary>What if the Agent wants to operate on an unbound knowledge base? </summary>

Do not expand access to all knowledge bases. Confirm the task truly requires it, then add the target library to the current Agent or switch to an Agent that already has that library bound.

</details>

## Continue Reading

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Using in Chat </strong></td><td>Complete an instant, sourced Q&A. </td><td><a href="chat.md">chat.md </a></td></tr><tr><td><strong>Data, Privacy, and Maintenance </strong></td><td>Understand permissions, cloud services, and backup boundaries. </td><td><a href="data.md">data.md </a></td></tr><tr><td><strong>Knowledge Base Application Cases </strong></td><td>Reference after-sales and research workflows. </td><td><a href="cases.md">cases.md </a></td></tr></tbody></table>
