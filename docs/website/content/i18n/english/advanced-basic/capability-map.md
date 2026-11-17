---
description: Selecting current capabilities based on goals
icon: route
---
# Advanced Capability Map

Advanced tutorials do not list settings menu items one by one; instead, they start from "what work you want to accomplish." First, select the goal closest to your needs, then proceed to the corresponding tutorial.

<figure><img src="../../../assets/3662cb6d32753bcb081fc9a4.webp" alt="Flowchart for selecting Cherry Studio work entry points based on goals"><figcaption><p>Start with the main entry point to complete the minimal task; once results are stable, add knowledge bases, skills, MCP, channels, or scheduled tasks. </p></figcaption></figure>

{% hint style="success" %}
When you need to configure a tutorial, channel, scheduled task, or extended capability, prioritize telling the Agent your goal in [Work]. The Agent can help identify what is missing and guide you through common configurations; when you need to verify accounts, keys, or precise parameters, manually adjust them in [Settings].
{% endhint %}

First select the main entry point based on your goal, then add skills, MCP, channels, or scheduled tasks once the workflow is stable.

### Select Entry Point by Goal

| What you want to accomplish | Recommended entry point | Capabilities involved |
| ------------- | ----------------------- | --------------------- |
| Compare multiple answers, organize long discussions | [Chat] | Multi-model, context, citations, and artifacts |
| Process files or complete multi-step tasks | [Work] | Agent, working directory, tools, permissions, and status panel |
| Stable Q&A using your own materials | [Knowledge Base] → Recall test, then bind to Agent | Files/Web pages/Notes, RAG, retrieval scope |
| Generate images from articles or edit images | [Drawing], or enable [Generate Image] in Agent | Templates, reference images, local editing, enhancement |
| Translate text, screenshots, or long documents | [Translation] | OCR, document processing, history, and favorites |
| Draft and continue processing content | [Notes] | Markdown, search, export, add to knowledge base |
| Capture interface, annotate, and copy text | [Settings] → [Screenshot] enable and use global shortcut | Region screenshot, annotation, mosaic, OCR |
| Open common web apps | [Mini Programs] | Built-in web tools and added sites |
| Browse, preview, and organize local files | [Files] | File list, preview, and subsequent processing |
| Connect external tools or fixed work methods | Let Agent judge first, then verify in [Settings] | Skills, MCP, built-in tools |
| Use Agent from external platforms | Let Agent guide configuration in [Work] first | Channels, allowed scope, permission mode |
| Generate daily reports or reminders on schedule | Run Agent first, then create [Scheduled Task] | Agent, working directory, channels, run logs |
| View materials and tasks simultaneously | Right-click tab → [Open in New Window] | Multi-window, pinned tabs, global search |
| Manage coding command line | Launcher [Code Mate] | Code CLI, model connection, directory, and terminal |
| Let local programs call models or troubleshoot | [Settings] → [API Gateway] / [General] | Compatible API, call chain, developer mode |

### Recommended Learning Order

{% stepper %}
{% step %}
#### 1. Master the Agent Workspace first

Learn to create Agents, select working directories, and understand model division of labor and permissions. Subsequent extensions, automation, and project cases are built on this foundation.
{% endstep %}

{% step %}
#### 2. Then integrate materials and capabilities

Use knowledge bases for long-term materials, skills for repeated methods, and MCP for external systems. Add only one capability at a time and verify with small tasks.
{% endstep %}

{% step %}
#### 3. Finally automate or connect externally

Configure channels, scheduled tasks, Code CLI, or external APIs only after manual results are stable. This makes it easier to identify which link is causing issues when problems arise.
{% endstep %}
{% endstepper %}

### Read by Module

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Advanced Chat </strong></td><td>Multi-model, context, and artifacts </td><td><a href="chat/README.md">chat/README.md </a></td></tr><tr><td><strong>Agent Workspace </strong></td><td>From configuration and execution to file delivery </td><td><a href="agent-workspace/README.md">agent-workspace/README.md </a></td></tr><tr><td><strong>Knowledge and Content Workflows </strong></td><td>Knowledge base, notes, drawing, and translation </td><td><a href="knowledge-content/README.md">knowledge-content/README.md </a></td></tr><tr><td><strong>Extend Agent Capabilities </strong></td><td>Skills and MCP </td><td><a href="extensions/README.md">extensions/README.md </a></td></tr><tr><td><strong>Automation and External Reach </strong></td><td>Channels, scheduled tasks, and heartbeat </td><td><a href="automation/README.md">automation/README.md </a></td></tr><tr><td><strong>Efficient Workbench </strong></td><td>Multi-window, efficiency tools, and search </td><td><a href="workbench/README.md">workbench/README.md </a></td></tr><tr><td><strong>Development and Diagnostics </strong></td><td>Code CLI, API gateway, and call chain </td><td><a href="developer-tools/README.md">developer-tools/README.md </a></td></tr><tr><td><strong>Application Cases </strong></td><td>Nine complete workflows </td><td><a href="cases/README.md">cases/README.md </a></td></tr></tbody></table>

{% hint style="warning" %}
Working directories, MCP, channels, and high-permission modes expand the data scope accessible to the Agent. Provide only the directories, tools, and accounts needed for the current task; do not place API Keys, bot secrets, or private materials in public conversations or screenshots.
{% endhint %}
