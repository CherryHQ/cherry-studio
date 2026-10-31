---
icon: newspaper
---
# Channels and Scheduled Daily Reports

The operations team wants to automatically aggregate specified materials every weekday morning, generate a daily report, and send it to the team channel. Before automating the process, run it manually once to catch data gaps, path errors, and notification target issues early.

## Prerequisites

* A daily report Agent verified in [Work];
* Clearly defined data sources and a working directory containing only the required materials;
* A fixed format implemented as a skill;
* A connected channel with restricted message scope;
* A scheduled task for weekdays.

<figure><img src="../../../../assets/e2328ba60a3ff5012831c39e.webp" alt="Platform list and add entry in channel settings"><figcaption><p>Bind the daily report to a tested channel first, then select it as the notification target for the scheduled task. </p></figcaption></figure>

<figure><img src="../../../../assets/005c0418156c52d0a531192b.webp" alt="The daily project progress briefing scheduled task and complete prompt that have been saved and enabled in Settings"><figcaption><p>① The task is enabled and displays the next run time; ② The prompt clearly defines the four-part structure, missing data handling, and channel sending conditions. </p></figcaption></figure>

## Configuration Steps

{% stepper %}
{% step %}
### 1. Manually Generate a Daily Report

Instruct the Agent to output four sections: "Progress," "Metrics," "Risks," and "To-Do." Verify that it explicitly states when data is missing rather than fabricating content.
{% endstep %}

{% step %}
### 2. Configure the Notification Channel

Specify the platform and group to connect in the Agent conversation first, then verify credentials, allowed session IDs, workspace, and permission mode in [Settings] → [Channels].
{% endstep %}

{% step %}
### 3. Create a Scheduled Task

Have the Agent create a weekday schedule, or open [Settings] → [Scheduled Tasks] → [New]. Select the daily report Agent, working directory, execution time, and notification channel.
{% endstep %}

{% step %}
### 4. Test Immediately

Click [Run] after saving, then review the generated session, execution history, and channel messages. Do not wait until the next day to discover path or recipient errors.
{% endstep %}

{% step %}
### 5. Monitor and Adjust

Check duration, usage, and failure reasons for the first few runs. If data sources or team formats change, update the skill or task prompt. Avoid maintaining conflicting rules in multiple locations.
{% endstep %}
{% endstepper %}

## Example Task Prompt

```
Read the data added yesterday in the current working directory and generate a Chinese operations daily report. It must include progress, key metrics, anomalies, and today's to-dos. If data is missing, write "No data available" and list the missing files; do not fabricate values. Send the result to the configured team channel and save a Markdown copy in the working directory.
```

## Failure Handling

| Symptom | Check Location |
| ------ | --------------------- |
| Did not run | Scheduled task status, next run time, system sleep |
| Run failed | [Execution History] → [View Session] |
| File not generated | Working directory, permission requests, and Agent file tools |
| Message not delivered | Channel status, recipient target, and platform logs |
| Duplicate content | Whether heartbeat and multiple identical schedules are enabled simultaneously |

## Recommended Setup and Completion Criteria

| Item | Recommended Practice |
| ----- | ---------------------------------- |
| Agent | Manually run the same daily report first, then hand it over to the scheduled task |
| Schedule | Prefer [Daily] or [Weekdays], and confirm the next run time |
| Channel | Send to a test session first, then switch to the official group |
| Completion Criteria | Execution history shows success; report file opens correctly; channel receives only one message; no fabricated results when data is missing |

{% hint style="warning" %}
Scheduled tasks run unattended. Before going live, maintain minimal file scope and appropriate permissions. Avoid assigning high-risk writes or external modifications to full access mode.
{% endhint %}

{% hint style="info" %}
The demo environment in the screenshot does not have an external channel bound, so it only displays the saved and enabled task. For production use, click [Run], confirm [Execution History] shows success, and verify a real message appears in the test channel before daily operation.
{% endhint %}
