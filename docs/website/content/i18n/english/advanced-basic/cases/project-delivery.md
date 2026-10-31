---
icon: folder
---
# Agent Project File Delivery

Operations colleagues need to organize scattered materials into an index, summaries, and delivery files. To prevent accidental modification of originals, clearly define the Agent's working directory, editable scope, and acceptance criteria in advance.

## Suitable Tasks

* Organize scattered materials into a table of contents and index;
* Generate multiple documents based on templates;
* Modify code and leave change logs;
* Batch rename, convert, or check files.

<figure><img src="../../../../assets/538ad1007c78fe2d3e4c41b6.webp" alt="An Agent conversation that ends with a generated Markdown file and an Open with button"><figcaption><p>The Agent workspace places tasks, models, working directories, and delivery files on the same page. </p></figcaption></figure>

<figure><img src="../../../../assets/d632d02956ab966e8f1594ff.webp" alt="The Files panel next to an Agent conversation, showing the generated presentation file"><figcaption><p>Generated files appear in the reply and in the Files panel on the right.</p></figcaption></figure>

## Workflow

{% stepper %}
{% step %}
### 1. Select the Minimal Working Directory

Select only the current project directory. Ensure important files have backups or version history, and start permissions with [Ask Before Acting].
{% endstep %}

{% step %}
### 2. Define Editable and Read-Only Scope

Clearly specify which files are read-only, where outputs are stored, which operations require prior confirmation, and the completion criteria.
{% endstep %}

{% step %}
### 3. Have the Agent List a Plan First

For high-risk tasks, use [Plan Only]. After confirming the file list and steps, switch to an editing-enabled mode to execute.
{% endstep %}

{% step %}
### 4. Check Status and Files on the Right

For long-running tasks, first check [Status] to see if it is waiting for approval. After outputs are generated, preview them in [Files]. Confirm accuracy before handover; do not substitute "task ended" for acceptance.
{% endstep %}
{% endstepper %}

## Example Task

```
Organize the current directory. Files in raw/ are read-only; create an index, summary, and list of missing materials under deliverables/. Obtain confirmation before any deletion, overwriting, or bulk renaming. Finally, list all newly added and modified files.
```

## Recommended Configuration

| Capability | Suggested Usage | Why |
| ---- | ------------ | ----------------- |
| Working Directory | Use a separate directory for each project | Clear file boundaries and delivery locations |
| Permissions | Keep [Ask Before Acting] for file modifications | Helps detect accidental deletions, overwrites, and out-of-scope writes |
| Status Panel | Check outputs and failed steps before finishing | Do not rely solely on "Agent says it's done" |
| New Task | Start a new task for new phases or clients | Prevents historical requirements from affecting current delivery |

{% hint style="danger" %}
[Full Access] reduces confirmations but also expands the impact of misoperations. Consider temporary use only in isolated, trusted, and recoverable directories.
{% endhint %}
