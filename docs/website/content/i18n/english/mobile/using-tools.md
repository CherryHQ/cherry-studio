---
icon: wrench
---

# Let AI Use Tools

Tools let an agent retrieve information or perform an action: read a web page, check your calendar, or save an answer as a file. The model then uses the result to continue its response. You do not need to remember tool names—describe the material, task, and result you want.

## Which tool do I need?

| Your task | What to prepare | Guide |
| --- | --- | --- |
| Research or read web pages | Enable the agent's web capability and configure search and reading services | [Web Search and Page Reading](web-search.md) |
| Check schedules, create events, or manage to-dos | Enable calendar or reminders and grant system permissions | [Calendar and Reminders](calendar-and-reminders.md) |
| Get your current location or summarize recorded activity | Enable and authorize the device capability; health is iOS only | [Location and Health Records](location-and-health.md) |
| Save a checklist, table, or web page | Select a text model that supports tool calls | [Create and Edit Files](file-generation.md) |
| Turn an HTML file into an image or presentation | Open the saved HTML file and use its share menu | [HTML to Image and PPT](html-export.md) |
| Read or update material in Feishu, Notion, and other services | Connect the plugin with an account that can access the material | [Plugins and External Tools](plugins.md) |
| Ask a text agent to generate an image | Enable image generation and configure a drawing model | [Image Generation](image-generation.md) |
| Use a remote tool service someone provides | Add an MCP server from Plugins and enable it for the agent | [Custom Tool Setup](plugins.md) |
| Organize project files or restore deleted items | Standard mode and clear source/destination items | [File library and workspaces](file-library.md) |
| Reuse a task method | Install a skill and enable it for the agent | [Skills](skills.md) |

App tools, plugins, and skills require Standard mode and a tool-capable model. Native model web access has its own requirements, described in the web guide. Manual HTML conversion does not require a tool call. Checking a capability flag in the model editor cannot add support the model lacks.

## Try one small task first

1. Use Standard mode with a text model that supports tool calls.
2. Edit the current agent and enable the capability you need in its **System** section. File reading and writing have no separate system capability switch.
3. Connect an account for plugins, or grant permission when using device capabilities. An agent switch and a system permission are separate requirements.
4. Ask for one specific task, inspect the result, then continue.

Start with:

> First list the writable calendars on my phone, then read tomorrow's events. Sort them by start time and name the calendar for each. Do not create or change anything.

After the result returns, replace Personal below with an actual writable calendar from the result. If none is available, set one up in the system calendar first:

> In the Personal calendar you just listed, create “Organize materials” tomorrow from 3:00 to 3:30 p.m., Beijing time. Tell me whether it was saved successfully.

Separate requests help you confirm the target. To have the app request approval before eligible actions, also change the agent's approval mode to **Ask when needed**. A written instruction to ask first does not replace that setting.

## Make requests specific

Include **where the material is → the date or content range → the action → the output format → whether to make changes now**.

* “Read this Feishu document: [link]. Summarize only section two as owner, task, and deadline. Mark missing details as unconfirmed. Do not create tasks yet.”
* “Turn my attached checklist into a CSV file with item, quantity, and notes columns. Save it as packing-list.csv.”
* “Use Amap to compare public transport routes from People's Square in Shanghai to Hongqiao Railway Station. Include transfers and estimated duration. Do not read my phone's location.”

One task can combine files, web pages, calendars, and plugins, but each capability must be available. Reading a document does not grant permission to create tasks; getting your location does not connect a route-planning service.

## Why do only some actions ask for approval?

| Action | With Ask when needed |
| --- | --- |
| Built-in search, file reading, and reading authorized calendar/location data | Usually runs directly |
| iOS health queries | Always asks, even under automatic approval, and identifies the data recipient |
| Moving, renaming, trashing, or restoring files/folders | Asks; automatic approval can execute directly |
| Built-in text file creation and editing | Runs directly; this mode does not prompt for every file change |
| Creating, updating, or deleting system events and reminders | Requires tool approval |
| Plugins and custom tools | Follows tool rules and may require approval |
| Image generation through a text model | Always requires approval, including in Automatically approve mode |

**Automatically approve** approves eligible actions, while account and system permissions still apply. New agents currently default to this mode. See [Agents and Tools](agents-and-tools.md).

## Calculations and multi-tool tasks

Ask the agent to calculate dates, totals, statistics, or transform data, then inspect its code and result. For example: “Calculate totals by category and save a CSV.”

Code Mode can combine authorized tools through code without adding account or system permissions. Mobile code execution is restricted; it is not a desktop terminal and cannot run scripts bundled with skills. You can also request specific agent-name or instruction changes in chat and inspect the result.

## How do I know the task finished?

Tool operations appear in the response's process details. Preparing content, waiting for approval, or asking you to continue in a system app does not mean the action is complete.

* **Reading succeeded:** check the source and query range before relying on the summary. An empty result does not always mean no records exist.
* **A file was created:** open its file card or find it under Files in the sidebar. A code block or a sentence saying “created” does not establish that a file was saved.
* **An external change succeeded:** check the tool result and, when needed, the target calendar, document, or task.
* **Only part succeeded:** identify completed actions and finish only what remains.

## What if it stalls or fails?

| What you see | Next step |
| --- | --- |
| A text answer without a tool call | Explicitly request reading or saving; check the model, capability switches, and connections |
| Waiting for approval | Review the target and action, then allow or reject; system permission may be a separate step |
| Insufficient permission | Resolve it in system settings or the service; rewording the request cannot grant access |
| Search or reading failed | Check the reported network, link, or account problem, and try a narrower range |
| A write timed out with an uncertain result | Check the target service before retrying to avoid duplicates |
| Android opened the calendar app | Review and finish the action there; opening a form does not confirm saving |

Stopping a reply, deleting a chat, or regenerating an answer does not undo completed external actions. Retrieved material may also be sent to your selected model. See [Data, Privacy, and Permissions](data-privacy.md).
