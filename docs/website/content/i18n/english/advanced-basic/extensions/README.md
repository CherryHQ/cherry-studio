---
description: Skills, MCP, and capability boundaries
icon: plug
---
# Extending Agent Capabilities

Agents come with built-in tools for files, search, images, memory, workflows, and scheduled tasks. Add skills when you need fixed working methods, and add MCP when you need to connect to external systems. They solve different problems, so you don't need to install everything just to have "more features."

<figure><img src="../../../../assets/9a40f1cd26f6618a31c73d42.webp" alt="Relationship diagram for selecting built-in tools, knowledge base, skills, or MCP based on materials, fixed methods, and external system requirements"><figcaption><p>Prefer the shortest path; only add MCP when the Agent genuinely needs to access external systems. </p></figcaption></figure>

## Determine What You Need First

| Requirement | Choice |
| ----------------- | ---------- |
| Fixed steps, templates, or checklists | Skills |
| Querying databases, browsers, or third-party systems | MCP |
| Retrieving your own documentation | Knowledge Base |
| Reading/writing current project files, generating images, or sending notifications | Agent built-in tools |

{% hint style="success" %}
The most convenient approach is to describe your goal directly in [Work] and let the Agent help you determine whether you need a skill, MCP, or knowledge base. If you need to verify sources, connection parameters, or permissions, go to [Settings] to manage them manually.
{% endhint %}

## Final Step After Installation

A global installation or successful connection does not mean every Agent can use it. Open [Work] → Agent menu → [Edit], and select from [Skills], [MCP], or [Knowledge Base] respectively. Configuration takes effect from the next message.

<figure><img src="../../../../assets/2351267cfa27c4d2d69ffa4b.webp" alt="Built-in tools, knowledge base, MCP, and skill entries in the Agent editing window"><figcaption><p>Configure Agent built-in tools, knowledge bases, MCP, and skills separately, enabling them as needed for each task. </p></figcaption></figure>

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Skills and Capability Library</strong></td><td>Install and reuse stable working methods</td><td><a href="skills.md">skills.md</a></td></tr><tr><td><strong>MCP and External Tools</strong></td><td>Connect additional tools and data sources</td><td><a href="mcp/README.md">mcp</a></td></tr><tr><td><strong>MCP Troubleshooting</strong></td><td>Locate issues step-by-step along the connection chain</td><td><a href="mcp/troubleshooting.md">troubleshooting.md</a></td></tr></tbody></table>
