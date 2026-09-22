## Why

The Prometheus stack has exactly three services — SurrealDB, surreal-memory and the liter-llm
gateway — and they run in Docker on every platform. The Boss has **no Docker awareness at all**
today: six files mention the word and all six are incidental (trash handling, destructive-command
heuristics).

The detection logic is not ours to write. The mini specifies `lib/platform/docker.mjs`
`dockerState()` → `{ state: 'absent' | 'daemon-down' | 'ready', client, server }` from
`docker version --format '{{json .}}'`, with no `wsl.exe`, no socket access and no dependency, and
`scripts/services.mjs` for `up | down | status | logs`. Reimplementing that here would produce two
implementations that drift.

The division is: **the mini probes and acts; The Boss asks, renders and consents.**

## What Changes

- Spawn the mini's `scripts/services.mjs status` to read state, and `up`/`down` on explicit user
  action — exactly as `prometheus-003` spawns `doctor.mjs`.
- Render the three Docker states with the platform's next step (install Docker Desktop on
  Windows/macOS, the engine on Linux) **without performing it**.
- A Docker consent preference: the app SHALL NOT start containers without it.
- Everything degrades. The pack works with all three services down, so absent or unreachable is a
  reported status and never an error dialog or a failed startup.

## Impact

- Affected: the Prometheus settings section from `prometheus-003`, a services panel, one
  preference key in `classification.json`.
- **Blocked on the mini’s `docker-services` change**, which creates `lib/platform/docker.mjs` and
  `scripts/services.mjs`. That change is NOT in this phase — it is an existing, unstarted change in
  the mini’s own backlog (15 tasks, 0 done), and this phase deliberately does not duplicate it.
  **Goal C is therefore split:** the mini’s change implements detection and compose; this change
  implements the consent, the rendering and the spawn. Neither alone satisfies goal C, and this
  change cannot be completed before the other lands. Until then it implements only the
  “detection unavailable” path, which is a real and testable state, not a placeholder.
- Security (A-3): starting containers is a user-consented action. The mini's compose binds
  loopback-only and keeps credentials in a git-ignored env file; The Boss adds no secret and
  passes none.

## Non-goals

- Writing Docker detection, a compose file, or container lifecycle here. All of it is the mini's.
- Shipping a fourth service, or any native daemon on Windows.
- Auto-starting containers without consent.
