# Automation REPL

A persistent standard-JavaScript interface for conversation-owned Browser and Computer Use. It is available independently of Code Mode. It does not expose Node modules, filesystem access, subprocesses, network fetch or timers.

## Ownership and dependencies

- `AutomationReplService` is a WhenReady lifecycle service depending on `UtilityProcessManager`, `BrowserSessionService` and `ComputerUseService`. Runtime adapters call it; it does not subscribe to or depend on Agent runtime state.
- Each `(kind, conversation, owner)` has one independent utility process and QuickJS WASM context. The service serializes cells, permits one active run, caps sessions at 16, and disposes inactive sessions after 30 minutes.
- `beginRun(owner, runId, access, signal)` binds trusted identity and a live access callback. Its `AutomationRun` exposes `execute`, `reset`, and idempotent `finish`. The model cannot supply identity or permissions.
- Browser controllers and Computer Use tasks belong to a run. A logical Agent continuation (`row-roll`) keeps that run. Terminal/idle events finish it, abort admission, drain child calls and release leases; JS bindings remain for the next turn.
- Agent connection disposal closes the REPL. Ordinary chat uses cancellable `acquireRun()` admission: sibling model responses wait until the active response releases its run, preserving exclusive control and the original capability ceiling. Completion/abort/error hooks cancel pending admission and release acquired runs. App shutdown stops runtimes before the REPL and stops the REPL before its dependencies.

## Guest API

The REPL calls Browser and Computer domain services directly; it does not call atomic MCP tools or parse their display text. MCP remains only an optional outer `js`/`reset` transport for Agent runtimes. Existing external browser MCP consumers retain their adapter.

```js
var tab = await browser.getTab()
// Read the emitted documentation and initial state before the next cell.
await tab.goto('https://example.com')
await tab.getAXState()
```

`computer.getApp(nameOrId)` returns an application proxy and emits initial AX state. Proxies retain target identity, not native resources. A new run must observe again before acting; stale Computer refs cannot survive an action. The host rechecks permission and ownership for each call, including rebinding. Scope remains the conversation's browser pane and authorized desktop applications.

Browser actions do not automatically capture AX state. Explicit observations return bounded full trees, so internal snapshots cannot consume a model-facing diff baseline. Computer refs include an observation generation. Screenshot-only observations do not grant element refs. Browser and Computer usage instructions are versioned in [Browser API](../../../../resources/skills/cherry-browser/references/api.md) and [Computer API](../../../../resources/skills/cherry-computer/references/api.md), emitted once per surface and available again through `documentation()`.

The pinned SDK 0.1.6 provides `perform()`, separating execution from observation. AX reads request `includeScreenshot: false`, skipping native capture rather than discarding an image after capture. SDK and native packages must use matching versions; no local checkout dependency is committed. Name resolution works for running apps; background launch is supported on macOS and waits for an accessible window. Unsupported launch on other platforms is explicit.

Observation text and images share an ID. Output retains newer complete image groups within four images / 16 MB of base64, explicitly marking omitted older images. Oversized text is reported as incomplete instead of silently sliced; each explicit Browser observation is independent of prior output. Ordinary JS errors retain bindings, while cancellation/crash/reset clears them. Errors preserve code/effect and do not replay actions.

Ordinary chat exposes `automation_repl` and `automation_repl_reset`. Agent runtimes expose the `automation` server's `js` and `reset` tools through their transport adapters. Browser/Computer individual MCP servers are no longer mounted for Agent sessions; Pi gives the REPL direct exposure.

## Context feedback

Each execute/reset result includes `structuredContent.replContext` and an assistant-only `REPL_CONTEXT` text block for transports that forward only content. The renderer omits that block from ordinary output. Screenshot observations, their metadata and image-budget notices are assistant-only; they remain in model-facing tool results without a user-facing count, preview or standalone message block. Ordinary text and capture errors remain visible. Intermediate screenshots therefore do not split tool groups or alter collapse behavior. Execute accepts an optional `title` for the tool card; existing records fall back to the translated default label.

The kernel owns the generation ID and binding inventory; the host adds a cell ID and reports cleared state after process cancellation/failure. Feedback distinguishes cells that never started, started but failed, completed, or were interrupted. `hostCallsStarted` counts attempted bridge calls, not successful actions or rollback guarantees.

Acorn extracts top-level lexical declarations. An execution-entry callback registers them only after declaration instantiation succeeds. QuickJS then supplies readability and primitive type metadata, so a failed initializer leaves an occupied but unreadable binding. Global properties use own-property descriptors; inspection does not read accessors or serialize values. `canRedeclare` for globals means a var-style declaration, not permission to repeat a lexical declaration. Block-local bindings and built-in globals are excluded. The list is bounded to 100 names and 12,000 serialized characters, with explicit truncation.

## Failure boundaries

QuickJS provides the guest language boundary; the utility process provides crash isolation and killable execution, not an OS sandbox. Only validated, allow-listed Browser/Computer host calls cross the boundary. Each call rechecks the active run, owner and capability, intersected with the capabilities granted at run start. Native SDK ownership, snapshot validity, global control settings and sticky user-stop remain enforced by their host services.

Cells have a 60-second deadline, a 32 MiB QuickJS allocation limit, 64,000-character source limit, 256,000-character bridge payload limit, and bounded text/image output. A timeout, cancel or process failure clears JS state and is reported explicitly. Side effects are never replayed. Unawaited host operations are drained before returning; cancellation closes admission and fences late RPC replies. Normal script errors preserve bindings; the model must observe state before deciding whether another action is appropriate.

No cross-platform desktop acceptance is implied by kernel or protocol checks. Native accessibility, screenshots and user-stop behavior still need real macOS/Windows/Linux acceptance.

## Local SDK development

Build the SDK with `npm run sdk:build` in its workspace and build the matching native app with the platform script. For this checkout only, point the existing `node_modules/@cherrystudio/computer-use` symlink to the SDK package and `.context/computer-use-runtime` to its matching native artifact, preserving both original links under `.context/`. Restart the tracked Electron instance after changing these links. Keep package manifests and lockfiles pinned to published versions; reinstalling dependencies restores the published client. Restore both links together to roll back.

The macOS Dev bundle has a separate permission identity from the release bundle. Grant it Accessibility and Screen Recording before desktop acceptance; a successful native handshake or build does not prove those permissions.

## Skill delivery and API revisions

Bundled `cherry-browser` and `cherry-computer` skills describe task routing and
recovery. Their `references/api.md` files are also imported by the REPL, so installed
references and first-binding output share one source. Common execution rules live
in `skills/repl.md`. `documentation()` re-emits both common and surface instructions;
reset or a cleared kernel causes them to be delivered again on use. Claude and Pi
filter these app-owned skills using the same capability policy as tool mounting.
User-owned and workspace skills are not rewritten or filtered by these names.

The existing builtin installer compares content hashes as well as app versions and
refreshes the installed copy and mirror. Changed API bootstrap code clears old JS
bindings before execution; the host releases previous leases and clears its document
cache. Installing a new main-process build requires restarting Cherry.

`structuredContent.execution` and the assistant-only `EXECUTION` block preserve up
to 64 recent action receipts/errors with an explicit omitted count. Failures include
operation, known target, code and effect; an observation failure does not erase a
preceding completed action. Kernel failure clears bindings and releases run control.
Desktop cleanup-unconfirmed remains blocked and reports `CLEANUP_UNCONFIRMED`, not
`USER_STOPPED`; neither reset nor rebinding grants control.

## Acceptance and remaining scope

Real Claude Sonnet 4.6 runs in Cherry have completed the Browser navigation task
(four cells) and macOS Calculator `5192 → 649` (three cells, two delivered images),
including `typeText` keyboard input. These runs establish the main flow, not all
lifecycle or platform behavior. CI contract tests are added but local test suites
remain disabled at the user's request.

Remaining acceptance: user stop, revoked access, target
closure and interrupted native cleanup; output-budget recovery; multi-turn and
per-runtime skill discovery. SDK/native 0.1.6 is published with matching package
versions. Windows/Linux GUI behavior is not inferred from macOS.

Tab management beyond the current conversation pane is not implemented: no tab
inventory, explicit selection, creation, closing or cross-browser control. It requires
BrowserSessionService ownership/lifecycle support before new REPL methods or skills
advertise it. The current interface intentionally exposes only `browser.getTab()`. Shell tabs are separate from the conversation browser pane; future tab management must first define how tabs belong to Agent sessions and how that ownership appears in both surfaces.

Cold-start acceptance also exposed and fixed an SDK launch-readiness race: macOS now
waits for an accessible window after LaunchServices completion without activation.
A real-model run from a fully stopped Calculator passed in three cells with one
final screenshot. First-binding API/common documentation matched the bundled files
exactly; installed API copies also matched their source hashes after normal startup.

The model also completed a Wikipedia search-box submission and result screenshot in
four cells with no tool errors. A follow-up Calculator turn first attempted input
without a new observation; the host rejected it with `STALE_SNAPSHOT / effect: none`.
After rebinding, the model observed 649 and reached 650 without clearing or replaying
the earlier calculation. The stale-handle error now recommends observing the retained
handle rather than claiming rebinding is mandatory. This is recovery evidence, not
proof that the model always observes first. Output includes a cell-local observation
sequence and the preceding completed action when available.

Application launch requires SDK installed-identity resolution. Cherry checks the
resolved identity against user stops and active owners before requesting launch;
the SDK verifies that identity before the native effect. The published SDK/native
dependency is pinned to 0.1.6; an older explicitly configured runtime fails closed
for launch. Existing running applications remain usable.

Browser navigation keeps caller cancellation across guest replacement and binds
subsequent navigation commands to the new guest. The completed result explicitly
invalidates the old tab handle; the model must reacquire the conversation tab.

Initial tab observations blocked by a dialog still return the tab handle and dialog
metadata, allowing `handleDialog()` recovery. Result-formatting errors from guest
getters or `toJSON()` retain bindings; cancellation and runtime failure still clear them.
