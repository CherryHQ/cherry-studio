---
icon: calendar-week
---
# Notes to Weekly Report

A project lead has accumulated meeting notes, progress updates, and scattered to-dos over the week and wants to organize them into a stable, fact-checkable weekly report by Friday. The key is to standardize the recording method first, then let the Agent summarize, rather than having it guess missing statuses.

## Workflow

{% stepper %}
{% step %}
### 1. Standardize Recording

Record items in the same notes folder daily, including at least the date, outcome, owner, and status. Do not mark incomplete items as delivered.
{% endstep %}

{% step %}
### 2. Manual Cleanup on Friday

Merge duplicate items and fill in key figures and links. Place long-term background in the knowledge base, and keep this week's changes in the current notes.
{% endstep %}

{% step %}
### 3. Generate Draft with Agent

Request output structured as "Completed This Week, In Progress, Risks, Next Week's Plan," and list missing items when data is unavailable.
{% endstep %}

{% step %}
### 4. Review and Export

Verify status, figures, and responsible parties, then finalize and export in [Notes]. Stable formats can be saved as skills for reuse next week.
{% endstep %}
{% endstepper %}

## Example Task

```
Read this week's notes and generate a weekly report draft. Merge items with the same subject but retain status changes across different dates; do not speculate on completion status. List missing owners, figures, or next steps under "To Be Supplemented".
```

## Recommended Setup and Completion Criteria

| Item | Recommended Approach |
| ----- | --------------------------------- |
| Daily Input | Record notes by date or project, focusing only on facts and to-dos |
| Agent | Use a fixed weekly report structure, reading this week's notes before generating |
| Output | Write the weekly report to a separate file, without overwriting original notes |
| Completion Criteria | Each progress item can be traced back to original notes; incomplete items have an owner or next step; no fabricated data |

Suitable for organizing already recorded work into a weekly report, not suitable for having the Agent guess weekly achievements based on scattered memories.

{% hint style="info" %}
Before setting up automatic weekly report generation at a fixed time, run it manually for a few weeks. Only create a scheduled task after the input format is stable and missing information handling is reliable.
{% endhint %}
