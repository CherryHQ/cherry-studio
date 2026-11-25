---
icon: file-lines
---
# Long Document Review

A product manager receives a lengthy proposal and needs to identify factual errors, structural gaps, and actionable revisions while preserving the original draft and the human confirmation process. The following approach is suitable for reports, policies, bid documents, and product proposals.

## Recommended Setup

* [Chat]: Quickly compare review perspectives from different models;
* [Work] Agent: Reads the working directory and generates a revised draft;
* Knowledge Base: Provides policies, terminology, or historical materials;
* [Files] on the right: Inspect the original draft and generated outputs.

<figure><img src="../../../../assets/861fd559d589c892d6c82334.webp" alt="The entry points for files, folders, notes, and URL sources in the Knowledge Base"><figcaption><p>Policies, terminology, and historical materials can serve as Knowledge Base sources, while the original draft remains in a separate working directory. </p></figcaption></figure>

<figure><img src="../../../../assets/d3679aebd8f1fdf0aa6058bf.webp" alt="The five-item review checklist covering scope, timeline, budget, risks, and acceptance criteria provided by Cherry Assistant based on the project proposal content"><figcaption><p>① Input the original text and review criteria; ② The actual results point out gaps item by item, retaining unconfirmed information as items pending verification. </p></figcaption></figure>

## Workflow

{% stepper %}
{% step %}
### 1. Prepare the Original Draft and Review Criteria

Place the original draft in a separate working directory. Create a brief review instruction document specifying the audience, purpose, immutable facts, and delivery format.
{% endstep %}

{% step %}
### 2. Perform Small-Scale Calibration First

Select one chapter and have the Agent output results in the format of "Issue, Original Location, Impact, Suggestion." Confirm the scale is appropriate before processing the full text.
{% endstep %}

{% step %}
### 3. Separate Facts from Expression

Require the Agent to list facts requiring verification separately, avoiding the use of language polishing to mask uncertain content. Verify key figures against the original sources.
{% endstep %}

{% step %}
### 4. Generate New Files and Finalize Manually

Require preserving the original file and generating an issue list and revised draft under `review/`. Use [Files] on the right to check paragraph by paragraph, then export or share.
{% endstep %}
{% endstepper %}

## Example Task

```
Review proposal.docx in the current directory. First, list factual issues, structural gaps, and expression problems by chapter, noting the original locations. Do not modify the original file; after confirming the checklist, generate a revised draft and a list of items to verify under review/.
```

## Pre-Use Preparation and Completion Criteria

| Item | Recommended Preparation |
| ---- | -------------------------------- |
| Files | Keep original text, review requirements, and output directory separate |
| Recommended Setup | Dedicated Agent + Working directory containing only project files + [Ask Before Acting] |
| Spot Check Method | Spot check one chapter first to confirm citation format and judgment scale |
| Completion Criteria | Each comment includes original location; unread parts are clearly marked; original file is not overwritten |

Suitable for structured review of contracts, reports, papers, or specifications. When involving legal, medical, or financial conclusions, the output should only serve as auxiliary material.

{% hint style="info" %}
When the document is very long, do not repeatedly paste the full text in a single chat. Have the Agent read the working directory directly and leave intermediate artifacts by chapter, which makes review and recovery easier.
{% endhint %}
