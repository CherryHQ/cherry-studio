---
description: Agents that let AI carry out tasks on its own
icon: robot
---

# Work / Agents

**Work** (also called **Agents**) is the system in Cherry Studio that can **call tools on its own, read and write files, and complete tasks across multiple steps** — it's not the same thing as a chat assistant, which is just a role preset. You'll find it under **Work in the left navigation bar** (not the top tab used in older tutorials).

{% hint style="success" %}
The easiest way to use it: tell the Agent what you want to accomplish and let it check for itself which models, tools, knowledge bases or channels are missing. Adjust things manually only when you need precise control.
{% endhint %}

<figure><img src="../../../assets/423b5b3c8e830efe73a0e87b.webp" alt="Work page with the agent and task list on the left, the conversation in the middle and a generated file preview on the right"><figcaption><p>The Work page: choose the agent, model and working directory along the top and enter your task below; manage tasks and agents on the left</p></figcaption></figure>

## What It Can Do

* **Read and write files**: give it a **working directory** and it can read, edit and create files there.
* **Call tools**: built-in tools, plus the [Skills](extensions/skills.md) and external [MCP](extensions/mcp/README.md) tools you attach.
* **Multi-step reasoning / subtasks**: break down a goal, dispatch sub-agents, and run background commands.
* **Plug into automation**: deploy it to IM platforms with [Channels](automation/channels.md), or run it on a schedule with [Scheduled Tasks](automation/scheduled-heartbeat.md).

## Quick Start

1. Open **Work** and choose an Agent. If you don't have one, click **Add Agent** and create one in four steps (Basic info / System Prompt / Skills / Knowledge). The built-in **Cherry Assistant** is ready to use.
2. If the task involves local files, choose a **working directory**; otherwise the default workspace is fine.
3. Describe the task in terms of "what should be delivered, which materials can be used, and what counts as done".
4. Follow **status / files / subtasks / message stream** in the right panel; with developer mode on, you can also see the **trace**.

<figure><img src="../../../assets/fa8f8e728cfe0f6eca0f741d.webp" alt="New Agent dialog on the Basic info step with avatar and name, runtime mode, permission mode and model"><figcaption><p>Creating an Agent: step 1 of 4 (Basic info)</p></figcaption></figure>

## Permission Modes

When an Agent works with files or commands, you can choose one of five permission modes, from most cautious to most hands-off: **Ask Before Acting / Plan Only / Auto-accept Edits / Approve for Me / Full Access**. Use the more hands-off modes only for unattended runs (such as Channels or Scheduled Tasks).

<figure><img src="../../../assets/906c724fab374eec468add69.webp" alt="Permission mode dropdown listing Ask Before Acting, Plan Only, Auto-accept Edits, Approve for Me and Full Access"><figcaption><p>The five permission modes</p></figcaption></figure>

***

## Want to Go Deeper?

See the Advanced Tutorials for the full workflow:

* [Agent Workspace](agent-workspace/README.md) — the complete way of working, from creation to delivery
* [Creating Agents and Dividing Work Across Models](agent-workspace/create-agent.md)
* [Working Directories, Tasks and Files](agent-workspace/workspaces-tasks-files.md)
* [Built-in Tools, Knowledge Bases, Skills and MCP](agent-workspace/tools-knowledge-skills-mcp.md)
* [Permissions, Memory and Background Tasks](agent-workspace/permissions-memory-background.md)

***

### Get Help and Submit Feedback

If you have any questions, bugs, or feature suggestions during configuration or use, please use the official channels listed in [Feedback and Suggestions](../question-contact/suggestions.md).
