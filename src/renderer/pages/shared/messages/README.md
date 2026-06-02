# Shared Message Wiring

This directory contains page/window-side hooks that assemble message rendering capabilities for Home, Agents, History, Quick Assistant, and selection windows.

These hooks may read preferences, call platform APIs, open popups, or delegate to services. They should not be imported by `src/renderer/src/components/chat/messages`; shared message components must receive these capabilities through provider values.

## Provider Assembly

`messageListProviderBuilder.ts` contains pure helpers for combining page-provided message state, actions, and metadata. It must not read preferences, call DataApi, touch `window.api`, or open UI. Pages and windows keep ownership of business data and pass already-created capabilities into the builder.

## Capability Matrix

| Surface | Expected capabilities |
| --- | --- |
| Home | Full write path: edit, delete, retry, branch, translate, multi-select, export, save code blocks, topic image export, trace, file operations, tool approval. |
| Agent | Capability-driven write path: delete where supported, multi-select, export, tool navigation, file operations, tool abort/approval, no Home topic write APIs. |
| History | Read-mostly path: render, copy, export, open references/files, navigate back to topic/message. No edit, retry, branch, or topic write operations. |
| Quick Assistant / Selection | Render-only message content plus platform copy/export helpers needed by that window. |

When adding a new message action, add it to the relevant page/window wiring first, then expose it through `MessageListActions` only if shared message UI needs to render or execute it.
