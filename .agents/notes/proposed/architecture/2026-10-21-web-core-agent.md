# Agent Note: Web Core agent

Status: proposed

English | [中文](2026-10-21-web-core-agent.zh.md)

## Problem

The Web edition's first release includes agent sessions (issue #21728; design document §2, §3.3 and milestone M2): the agent edits files in a workspace inside the browser, runs Python and JavaScript in sandboxes, and asks the user before risky steps. The Web app runs the desktop main window over the Core Worker ([Web app Spec](2026-10-20-web-core-app.md)), but the Worker replaces every agent entry module with a stand-in, so the Agents page cannot start a turn.

Desktop agents run through runtime drivers (Claude Code, Pi) behind one session host, `AgentSessionRuntimeService`. Both drivers need Node, a shell and the local disk; Pi's runtime alone is 1937 modules with 56 Node dependencies. The host itself is portable. Bundled for the browser, the host, `AgentChatContextProvider`, the workspace resolver and the prompt builder leak only through two things:

- session forks, which import Pi's session files;
- `fs` and `fs/promises`, for the agent data directory (`SOUL.md`, memory), workspaces and the built-in agent templates.

The desktop seeds two built-in agents, Cherry Assistant and Cherry Support, both of the Claude Code type, which cannot run in a browser.

## Proposal

Run the unmodified desktop agent-session host and agent UI over a browser runtime driver. All changes stay in `packages/web-core`; no file under `src/main`, `src/preload`, `src/renderer` or `src/shared` is edited.

1. **A file system in the Worker.** `fs` and `fs/promises` resolve to ZenFS with its OPFS backend, mounted at `/web` (the root of `application.getPath`) on the account's OPFS directory when the account opens, and unmounted on close.
   - ZenFS keeps an in-memory copy of the mount, so desktop code that calls `existsSync` or `readFileSync` works. Async writes resolve after OPFS has them.
   - ZenFS's async `rename` to a new path renames the file but rejects with `ENOENT`, so the shim routes it through the sync rename.
2. **The desktop agent-session host in the Worker.** `AgentSessionRuntimeService` starts with the account. `AgentChatContextProvider` and the workspace resolver are no longer replaced. The workspace storage service (user-chosen workspaces) and the lifecycle service (deleting and archiving, which needs workspace archives) stay replaced. Session forks are replaced by a stand-in that answers that the Web edition does not support them.
3. **A browser runtime driver registered as `pi`**, replacing `registerDrivers.ts`. New agents already default to Pi, so the agent UI, permission modes and tool cards need no change, and agent rows stay compatible with the desktop. Each turn:
   - reads the session's stored messages and builds the prompt with `buildAgentRuntimePrompt`;
   - runs the desktop AI SDK agent loop (`Agent` in `ai/runtime/aiSdk`) with the session's model through the same provider resolution as chat;
   - replays the loop's chunks as Pi events into the desktop `PiStreamAdapter`, so they carry Pi's transport tag, and ends with `turn-complete`.

   Tool approvals go through the shared `toolApprovalRegistry` and the existing `ai.tool.respond_approval` route. The driver has no resume token, steering, compaction or fork; follow-up messages queue as the next turn, the host's fallback.
4. **Browser tools** with Pi's native names and input shapes:
   - **File tools on the session workspace:** `read`, `write`, `edit`, `ls`, `find` and `grep`. There is no `bash`.
   - **Python:** `python_execute`, served by the unmodified desktop `PythonService`. It asks the page's Pyodide worker over the bridge.
   - **JavaScript:** `js_execute` runs in QuickJS-WASM (`quickjs-wasi`, already a desktop dependency) inside its own Worker, which is terminated when the run times out.

   Approval is the desktop Pi policy (`createPiToolAuthorizer`), applied by the agent's permission mode:
   - read tools (`read`, `ls`, `find`, `grep`) inside the workspace or the agent data directory run without asking;
   - edits ask in `default` mode and run without asking in `acceptEdits`;
   - code execution asks in `default` and `acceptEdits`;
   - `auto` asks only for a file tool outside those directories, and `bypassPermissions` never asks.

   The policy's guard against Cherry's SQLite files is replaced: the database is an OPFS file outside `/web`, so no file tool reaches it. Python can: it runs in the page's Pyodide Worker, which has the app's origin and can open the account's OPFS directory, database included. It is gated by the approval above, as `bash` is on the desktop, where it can also reach Cherry's database. JavaScript cannot: QuickJS gives a script no browser API.
5. **A pre-installed Web Cherry Assistant.** A Web seeder creates one Pi agent named Cherry Assistant, with a system workspace and a first session. The desktop Cherry Assistant and Cherry Support seeders are skipped.
6. **UI.** The Web sidebar adds Agents. Build-time replacements of two `src/shared` modules make the runtime capability table offer only Pi, hide heartbeat, skills, knowledge bases and MCP for it, and list the browser tools in the agent editor.
7. **Tests.** The mock provider learns to answer with tool calls, and `e2e/agent.spec.ts` drives the Agents page in Chromium, WebKit and Firefox.

Implementation lands in one PR on top of this Spec.

Out of scope: remote MCP from `configurations`, skills, scheduled and heartbeat runs, channels, session forks, deleting and archiving agents and sessions, user-chosen workspaces, attachments, and including workspace files in backups (milestone M4).

## Alternatives considered

- **Run Pi in the browser.** It needs a shell, Node streams and a session-file store; the design document's measurement rules it out.
- **A new `web` agent type in `src/shared`.** It gives Web agents their own identity, but edits shared schemas, the capability descriptors and renderer i18n, and the desktop would list a runtime it cannot run. It is left for the maintainers; registering as `pi` keeps the desktop unchanged.
- **Our own OPFS file system.** It could avoid holding the mount in memory, but it would reimplement Node's `fs` semantics, sync calls included. ZenFS is maintained and passed write, sync read, listing, rename and reload checks in all three browsers.
- **IndexedDB for files.** OPFS already holds the database and handles file contents directly.
- **Run the agent loop in the page.** The Worker already owns the AI layer and the database; the page would block the UI during tool runs.

## Acceptance criteria

- AC1 — In Chromium, WebKit and Firefox, the Agents page lists the pre-installed Web Cherry Assistant, and creating an agent offers only the Pi runtime. (verification: packaged artifact)
- AC2 — In `default` mode, an agent turn against an OpenAI-compatible endpoint calls `write`, waits for the user's approval, and creates the file in the session workspace. The reply, the tool call and the file are still there after a reload. (verification: packaged artifact)
- AC3 — A denied approval ends the tool call with the denial and leaves the file unwritten. `read`, `ls`, `find` and `grep` inside the workspace run without approval. (verification: packaged artifact)
- AC4 — `python_execute` runs Python in the page's Pyodide and returns its output. `js_execute` returns a script's result and stops an endless loop at its timeout. (verification: packaged artifact)
- AC5 — The existing Web Core tests still pass, the Worker build has no Node built-in, Electron or native import, and no file under `src/main`, `src/preload`, `src/renderer` or `src/shared` changes. The growth of the Worker's first download and the size of the QuickJS module are recorded. (verification: packaged artifact and change-scope report, recorded in the implemented note)

## Risks

- **The mount lives in memory.** ZenFS copies every file of the mount into memory when the account opens, so start-up time and memory grow with the workspace. Trial workspaces are expected to be small; the start-up time is measured and recorded.
- **Sync writes persist later.** A sync write returns before OPFS has it, so a reload right after one can lose it.
- **No compaction or steering.** A long session can outgrow the model's context window, and a message sent mid-turn waits for the next turn.
- **Agents stop with the tab.** As the design document states, closing the page ends a running turn.
- **Pi-typed rows.** If Web data later reaches the desktop, the desktop runs these agents with the real Pi, which also has `bash`.
- **Python reaches the account's data.** Python code can read and change the account's database and files, and send them over the network, once its call is allowed; in `auto` and `bypassPermissions` it runs without asking, as `bash` does on the desktop. Isolating Pyodide from the app's origin (for example a sandboxed iframe) must land before the agent can use a user-chosen local folder or the page holds login tokens (M3).
- **Pyodide comes from a CDN.** The page loads it from jsDelivr, which must keep sending CORS headers for the cross-origin-isolated page; private deployments may need to host it.
- **Workspace files are not backed up yet.** Clearing site data loses them until backup (M4) lands.
