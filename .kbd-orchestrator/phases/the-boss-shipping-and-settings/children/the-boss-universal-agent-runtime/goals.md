# Universal Agent Runtime as a the-boss agent runtime

Parent: the-boss-shipping-and-settings. Canonically created with `prometheus kbd phase create --parent`
on 2026-09-23. Activated after publication of The Boss 2.1.3; Compass delivery remains open only for
installed Windows acceptance. See `../../handoffs/release-to-uar.md` for the current baseline and WIP.

Operator-approved plan: `~/.claude/plans/agile-exploring-oasis.md` (decisions settled 2026-09-23).

## Goals

- `the-boss` supports the Universal Agent Runtime as a fourth agent runtime beside `claude-code`, `pi`
  and `dsh`, with its own per-agent configuration and an app-wide `/settings/uar` page.
- UAR ships as an embedded `uar-sidecar` binary downloaded from UAR GitHub Releases, built by CI on
  `main` for windows arm64/x64, macOS arm64/x64 and linux x64, with SHA-256 digests.
- AG-UI is the protocol, with A2UI surfaces rendered in the conversation, content-management and
  skill-selection algorithm selection, and every UAR option real (stub algorithms implemented in UAR).
- The-boss stays in control of each run: agent definition, provider credentials, approvals, and its own
  tools through a loopback, token-protected MCP endpoint. UAR runs the loop.
- UAR shares the Docker SurrealDB (namespace `uar`, its own credentials) and falls back to its embedded
  store when Docker is down.
- The decided architecture passes deep research and an adversarial decision review before any code.

## Worktrees

- the-boss: `~/Projects/prometheus/worktrees/the-boss-uar`, from `origin/main`.
- UAR: `~/Projects/prometheus/worktrees/uar-the-boss-sidecar`, from the local
  `feat/context-history-integrity` (which now includes the Codex session's transferred work, commits
  `ab616d15`..`ba128451`; `ab616d15` is unverified).

Windows remains unverified until run on Windows hardware.
