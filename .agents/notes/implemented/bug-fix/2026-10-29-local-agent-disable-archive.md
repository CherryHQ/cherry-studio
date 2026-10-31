# Agent Note: Disabling a local Agent archives its conversations

Status: implemented

English | [中文](2026-10-29-local-agent-disable-archive.zh.md)

## Problem

Turning off a local Agent only hid it from selection. Its conversations remained active, and disabling did not use the existing Agent archive lifecycle. Archiving without retaining the manager's access to the original row would also lose custom Agents from the manager and risk replacing preset configuration during re-enablement.

## Decision

The manager asks for confirmation before calling the existing Agent archive command with related conversations included. Cancellation and archive failure leave the Agent active. The confirmation explains the archive and WebUI stop, and asks users to stop running tasks first, as required by the existing archive checks.

The manager also reads archived local Agents. Their original configuration remains in the same row and is read-only while archived. Archive membership supplies the disabled UI state; disabling does not overwrite the saved runtime configuration. Re-enabling checks that configuration and calls the existing Agent restore command, retaining the ID, ordering, configuration, and conversations archived by that operation. Independently archived conversations remain archived.

Refresh failures are logged after a committed archive and do not prevent the WebUI stop attempt. A WebUI stop failure is reported without undoing the archive. No new table or alternative archive storage is introduced.

## Alternatives considered

- Keep only the enabled flag: conversations would bypass the requested archive lifecycle.
- Clear configuration or create a replacement Agent when enabling: loses configuration or historical identity.
- Restore archived Agents implicitly when editing settings: makes an edit change archive membership without the enable action.

## Consequences

Archived configuration is visible but requires re-enablement before editing. Archive's existing busy-session checks and retention rules still apply. Once an item is permanently removed, the manager cannot restore its prior data.

## Verification

- Regression — `LocalAgentDirectory.test.tsx`, `LocalAgentDirectoryCli.test.tsx`, and `CodeCliPage.test.tsx`: 55 tests passed, including cancellation, archive failure, preserved configuration on restore, restore failure, WebUI stop failure, and reopening an archived custom Agent without a creation drawer.
- Regression — `AgentLifecycleService.workspace.test.ts`, `AgentLifecycleService.recovery.test.ts`, and `LocalAgent.test.ts`: 45 tests passed and one platform case skipped; the existing lifecycle restores grouped conversations and workspaces while preserving independently archived conversations.
- Regression — Real Electron with a temporary custom ACP Agent: cancellation preserves the active Agent; archiving includes its active conversation; reopening retains the configuration; re-enabling preserves the ID, ordering and configuration, restores the grouped conversation, and leaves the independently archived conversation archived. Test records were removed afterward.
