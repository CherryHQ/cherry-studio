# Agent Note: Keep workspace identity in the Agent top bar after the first message

Status: implemented

English | [中文](2026-11-11-agent-top-bar-workspace-identity.zh.md)

## Problem

2.2.0 moved Agent session identity into a compact details card (see [Compact Agent session details card](../feature/2026-11-08-agent-session-details-card.md)) and, with it, made the top bar mount its workspace control only while the conversation was an eligible empty conversation: `AgentTopBarControls` passed `showWorkspace={!!onWorkspaceChange}` and `AgentConversationControls` skipped the whole control when it was `false`.

The workspace was never editable after the first message — that part is intended and is enforced by `PUT /agent-sessions/:sessionId/workspace` — but the *identity* disappeared with it. A conversation with one message rendered no folder, no workspace name and no directory-open action, while the same conversation before 2.2.0 rendered the read-only branch of the same control: folder plus workspace name inside an `OpenTargetButton` targeting `workspace.path`. Users reported the loss as "my working directory is gone after upgrading", and the loss tracked message existence, not the Agent's creation date or its stored configuration. See [issue #24211](https://github.com/CherryHQ/cherry-studio/issues/24211).

## Decision

Separate the workspace control's visibility from its editability. The top bar always mounts `WorkspaceControl`; only the selection and clearing affordances stay gated on an eligible empty conversation, expressed by whether `onWorkspaceChange` is supplied.

`isEmptyConversation` and `canChangeWorkspace` are unchanged: a session must exist, message history must be enabled, no loading, pending or older page may be in flight, and the conversation must have zero messages, before `handleSessionWorkspaceChange` is passed down. When it is absent, `WorkspaceControl` renders its existing read-only branch — folder, workspace name and the directory-open action for a user workspace — and a system workspace keeps the existing "No work directory" label with no user-folder opener. Selecting the opening application does not rebind the session workspace and stays available.

The server remains the authority that a non-root message blocks rebinding; no "ever sent" flag, configuration fallback, migration or workspace relabelling is introduced.

## Alternatives considered

- Tell reporters that session details owns the identity now and change nothing: the details card does show and open the directory, but it makes a working directory that was one glance away require opening a card, and the reported acceptance is specifically about the header.
- Render the full editable selector after messages exist: contradicts the write lock and invites a rejected change.
- Show the full path as a second line: a separate presentation change; the control's identity is the workspace name plus the open target.
- Read a legacy `agent.configuration.workspacePath` when the session workspace is a system workspace: `agent_session.workspace_id` is the single source of truth, that key has no reader, and guessing a directory from configuration would surface a wrong target.

## Consequences

A locked conversation keeps the folder, the workspace name and a working directory-open action; clearing or switching the workspace still requires an empty conversation, and the flow of sending the first message now only removes those two affordances. A system workspace still reads "No work directory" and gains no opener. The details card keeps providing the full path and its own actions, so the two surfaces now agree instead of one replacing the other.

## Verification

- Regression — `src/renderer/components/composer/variants/agent/__tests__/AgentConversationControls.test.tsx` renders the real control with no `onWorkspaceChange` and asserts the folder and name, the `external_app.target.open` payload for `workspace.path`, and the absence of selection/clearing; a system workspace case asserts the "No work directory" label, the disabled control and no opener.
- Regression — `src/renderer/pages/agents/__tests__/AgentChatWorkspaceIdentity.test.tsx` renders the Agent conversation and asserts the top bar keeps the workspace identity once the conversation has messages, while an empty conversation still exposes the selector.
- Regression — `src/main/data/services/__tests__/AgentSessionService.test.ts` keeps the existing cases that reject user-to-user, system-to-user and user-to-system workspace changes after a message.
- Regression — an Electron smoke run screenshots the top bar of a non-empty user-workspace conversation before and after the change.
