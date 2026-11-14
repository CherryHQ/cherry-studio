---
icon: comment-dots
---
# Channels

A channel connects an Agent to an external messaging platform. You can currently configure Telegram, Discord, Slack, and QQ; each platform requires different bot credentials and session identifiers.

{% hint style="success" %}
It is recommended to first instruct the Agent in [Work]: "Configure a Slack channel for the current Agent to receive group messages and send task results." The Agent will ask for the necessary information based on the use case, which is faster than manually filling in all platform fields. Use [Settings] → [Channels] when you need to make precise modifications.
{% endhint %}

## Manual Configuration Path

[Settings] → [Channels] → Select Platform → [Add].

{% stepper %}
{% step %}
### 1. Prepare Platform Account

Create a bot or application according to the platform's rules, then enter the corresponding Token or application credentials.
{% endstep %}

{% step %}
### 2. Bind Agent and Workspace

Select an Agent that has been verified to work, and specify a workspace for channel messages. External messages will execute in this context; do not select directories containing unrelated sensitive files.
{% endstep %}

{% step %}
### 3. Restrict Message Sources

Enter the allowed Chat ID, Channel ID, or User ID. Leaving this field blank may allow all sources, depending on the current platform's field description. You can send `/whoami` to the bot first to obtain the correctly formatted identifier.
{% endstep %}

{% step %}
### 4. Select Permission Mode and Enable

The default is [Inherit Agent Settings]. Use a stricter mode for public groups, multi-person groups, or untrusted sources. After enabling, send a test message with no side effects first.
{% endstep %}
{% endstepper %}

## Recommended Configuration

| Configuration Item | Product Default | Suggested Starting Point | Function | Applicable Scenarios | Notes |
| -------- | --------- | --------------- | ------------ | --------- | ---------------- |
| Bound Agent | Must be selected | Prepare a dedicated Agent for the channel | Determines who processes messages | Group chats, bot DMs | Do not mix with high-privilege development Agents |
| Workspace | Must be selected | Use a dedicated directory without personal data | Limits processable files | In-group collection, daily report delivery | Do not select the user's home directory |
| Allowed Message Sources | Depends on platform fields | Initially allow only test accounts or test groups | Restricts who can trigger the Agent | Internal testing, team groups | Read field descriptions before leaving blank |
| Permission Mode | [Inherit Agent Settings] | Use stricter approval for external entry points | Controls tool operations | Public groups, multi-person groups | [Full Access] is not recommended |

## Use Case: Team On-Call Group

Create an Agent that only handles the on-call manual, bind it to a knowledge base that has passed recall tests and a dedicated workspace, and allow only the on-call group to trigger it. First test two types of messages: "Look up a policy" and "Answer not found," then test generating a handover summary that contains no sensitive information.

### Completion Criteria

Disallowed sources cannot trigger tasks; responses return to the specified group; the system explicitly states when the knowledge base has no content; file writes still request approval.

## Platform Configuration Focus

| Platform | Main Credentials | Session Scope Focus |
| --------- | ----------------------- | ------------------ |
| Telegram | Bot Token | Chat ID |
| QQ | App ID, Client Secret | DM, group, or channel identifier format |
| Discord | Bot Token | Channel or DM ID |
| Slack | Bot Token, App Token | Socket Mode and Channel ID |

{% hint style="danger" %}
Bot Tokens, App Secrets, and verification tokens are equivalent to account passwords. Do not write them into long-term Agent memory, task prompts, screenshots, or public Issues; if leaked, immediately revoke and regenerate them on the platform side.
{% endhint %}

<details>

<summary>What if I cannot select a channel as the receiving target for a scheduled task? </summary>

First, proactively send a message to the bot on the corresponding platform so that Cherry Studio records the available Chat ID, then return to the scheduled task to select the notification target.

</details>

<details>

<summary>What if the channel is connected but does not reply? </summary>

Check the allowed session ID, bound Agent, workspace, and permission mode, then review the channel logs. If the platform received the message but the Agent did not execute, continue checking the API gateway and Agent task status.

</details>
