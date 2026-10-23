# Agent Note: Cross-Agent Session creation continues the target Agent workspace

Status: implemented

English | [中文](2026-10-20-cross-agent-session-workspace.zh.md)

## Problem

`session_create` with `target_agent_id` copied the caller's workspace. A human opening that Agent continues its own last workspace, so an Agent-created Session could land in an unrelated directory. The workspace binding locks on the first message, leaving the user no way to correct it afterwards.

## Decision

A cross-Agent Session resolves the target Agent's most recently active Session and reuses its workspace: a user workspace by id, or a fresh system workspace when that Session had none. Same-Agent creation keeps the caller's workspace, and an Agent with no Session falls back to the caller's workspace. This is the Agent-side counterpart of the renderer's same-Agent inheritance in `resolveCreateWorkspaceSource`.

## Alternatives considered

- Always keep the caller workspace: rejected because it contradicts how the same Agent behaves for a human and strands delegated Sessions in unrelated directories.
- Always use a system workspace: rejected because file-oriented delegation would start with no files.
- Add an explicit workspace argument now: deferred; Agent default directories (#19307) should supply that precedence once merged.

## Consequences

The resolution reads existing Session rows; no schema or migration change. A target Agent whose last Session is an empty placeholder still seeds from that placeholder. If the remembered user workspace was deleted, creation fails the same way a human Session does instead of silently choosing another directory.

## Verification

- Regression — `pnpm test:main src/main/ai/mcp/servers/__tests__/cherryAutonomyTools.test.ts`: cross-Agent creation uses the target Agent workspace instead of the caller, a target system workspace yields a fresh system workspace, and an Agent with no Session keeps the caller fallback.
