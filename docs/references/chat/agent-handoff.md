---
description: Explicit Chat-to-Agent handoff with an editable draft, independent target configuration, and current source-history reads
sources:
  - src/main/ai/agentSession/handoff.ts
  - src/main/ai/messages/readConversation.ts
  - src/shared/ipc/schemas/ai.ts
  - src/main/ai/mcp/servers/cherryAutonomyTools.ts
---

# Agent Handoff

Handoff starts a new Agent Session from a Chat conversation. The user selects an
Agent, reviews the generated task and summary, chooses a workspace and attachments,
and confirms before the target starts. Generating or cancelling a draft does not
create a Session or ask the source Assistant to answer.

## Draft generation

Main gathers the selected source branch and generates a target-oriented draft with
the existing prompt stream. The request does not inherit the source Assistant's
tools or MCP servers. The response includes the model used, source coverage, and
available attachments so the renderer can present what was included.

The configured quick model is preferred, with the source model as fallback. An
explicit summary model does not silently fall back. Capacity checks reject an input
that cannot fit; the source is not silently shortened to the composer's input limit.
Models without a declared context window can generate a draft; the provider reports
any capacity error, following the existing prompt-stream behavior.
The task and summary remain editable before confirmation. The preview also lets
the user select a different summary model and regenerate without changing global
model defaults.

## Confirmation and execution

The confirmation carries a stable handoff ID, target Agent, workspace, task,
summary, source reference, and selected file parts. The target uses its own model,
instructions, tools, and workspace. Source configuration is not copied into it.

The same confirmation must not create or execute a second first turn when retried.
Once a turn has been claimed, an uncertain execution is not automatically replayed.
If startup fails after creation, the created Session retains the handoff content
and can be opened to inspect the failure.

## Reading the original conversation

The target can call `session_read` with the source ID to read current messages.
It does not need a source type, a separate handoff permission, or a frozen snapshot.
The tool reuses existing Chat, Agent Session, and temporary-conversation services,
including their query parameters and pagination rules. A later source message is
readable; a deleted source is unavailable. Temporary sources remain available only
for their existing lifetime.

With `message_id` and `tool_call_id`, the same tool can reconstruct a persisted
tool result. Missing offloaded content produces the existing fallback, rather than
claiming that an excerpt is complete. Reading a conversation does not grant access
to its filesystem attachments; transferred files use ordinary target message file
parts and reference tracking.

## Agent-to-Agent delegation

`agent_list` discovers Agents even when they have no Sessions. An interactive
Agent can pass `target_agent_id` to `session_create` to create a Session for that
Agent. Omitting it retains creation under the sending Agent. The existing delivery
approval, workspace selection, accepted request, and asynchronous completion path
still apply; headless delivery turns cannot delegate again.

See [Agent Session Runtime](../ai/agent-session-runtime.md) for the delivery and
runtime authorization contract.
