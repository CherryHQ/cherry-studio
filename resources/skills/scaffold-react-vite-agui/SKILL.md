---
name: scaffold-react-vite-agui
description: >
  Layer an AG-UI agent host onto a scaffolded Vite/React project. Adds a zustand
  store that consumes the AG-UI event stream, a hook and panel that render it,
  and a Vite dev-server SSE endpoint backed by a mock agent. The generated app
  streams agent responses under `pnpm dev` with no second process. The mock
  endpoint is development-only; production needs a real backend implementing the
  same contract.
---

> ## UNAVAILABLE IN THIS PROJECT
>
> This skill drives a shell scaffolder that `prometheus-skills-mini` does not ship. The scaffolders are
> 2,879 lines of bash across 7 files that generate React/Vite/Tauri/Flutter starter projects; porting
> them is a separate change from the refiner core, and this project forbids executing a `.sh` at all
> (C1, C3) — so the commands below **will not run here**.
>
> The skill is carried rather than deleted so its interface and intent stay visible, and it says so
> loudly rather than appearing functional and failing on invocation. A loud absence beats a silent
> breakage.
>
> **Follow-up:** port the scaffolders to Node, or drop these skills. Tracked in
> `.prometheus/decisions.md` (2026-09-21, scope of the artifact-refiner port).

# Scaffold React + Vite + AG-UI Host

Wraps an existing `scaffold-react-vite` target with an
[AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui) agent host.

## Usage

```bash
bash scripts/scaffold-react-vite-agui.sh \
  --target <path-to-react-project> \
  [--feature <feature-name>] \
  [--route /api/agent/run]
```

`--target` must already be a `scaffold-react-vite.sh` project — this is a thin
wrapper in the same shape as `scaffold-react-vite-tauri.sh`, not a standalone
generator.

## What it emits

| Path | Role |
|---|---|
| `src/features/<feature>/stores/agent-store.ts` | Owns the connection; reduces events into state |
| `src/features/<feature>/hooks/use-agent.ts` | Reads the store |
| `src/features/<feature>/components/agent-panel.tsx` | Renders messages |
| `src/dev/mock-agent.ts` | Canned response replayed as protocol events |
| `src/dev/vite-plugin-agui-mock.ts` | Dev-server SSE endpoint |

It also pins `@ag-ui/client` and `@ag-ui/encoder` at exact `0.0.59`, registers
the plugin in the Vite config, and appends a README section.

## Layering

Placement follows `references/scaffolds/state-architecture.md`:

- **stores/** own all I/O and the single `initRealtime()` subscription (line 185)
- **hooks/** read stores — never `fetch`, never `EventSource` (line 210)
- **components/** read hooks

The store imports no React; the architectural ESLint config enforces it.

## Streaming

`TEXT_MESSAGE_CONTENT` deltas are **appended**, not replaced — `delta` is an
increment. Content for an unknown `messageId` is dropped with a warning rather
than synthesised, so a protocol ordering violation surfaces instead of hiding
behind plausible output.

## Development only

The mock agent and Vite middleware run in the dev server. `vite build` excludes
them, so a deployed build has no agent endpoint. Production requires a backend
answering:

```
POST <route>
  Content-Type: application/json      body: RunAgentInput
  Accept: text/event-stream
→ Content-Type: text/event-stream
  `data: {…}\n\n` frames, one JSON event each
```

Point the store at it with `useAgent({ url })`.

## Pinning

`@ag-ui/*` is pre-1.0 (`0.0.59`). Versions are pinned **exact** — a caret range
would admit a breaking change in a patch bump. `@ag-ui/client` transitively adds
rxjs, zod, uuid, fast-json-patch, untruncate-json, and compare-versions to every
generated app.

## Related

- `scaffold-react-vite` — the base scaffolder this wraps
- `scaffold-react-vite-tauri` — the wrapper pattern this follows
- `references/domain/ag-ui.md` — AG-UI spec refinement (a different concern:
  static spec documents, not the live runtime)
