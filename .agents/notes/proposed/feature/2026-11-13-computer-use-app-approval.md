# Agent Note: Enable Computer Use with remembered application approval

Status: proposed

English | [中文](2026-11-13-computer-use-app-approval.zh.md)

## Problem

Computer Use currently defaults to disabled. `ComputerUseService` owns application resolution, native sessions and stop controls, but does not ask for remembered application-specific consent. Approving an Automation REPL cell cannot establish consent for every application it may access dynamically.

## Proposal

Enable `app.computer_use.agent_control.enabled` by default through the preference generator source. Preserve an explicitly stored disabled setting. The setting enables the capability; application access in ordinary permission modes requires consent.

Resolve the actual application identity in the main process and ask before launching, opening a native control session, reading application content or sending input. Application discovery and identity resolution can run before consent. Show the application name and identity with exactly three decisions:

- **Always**: persist an allow grant for this application on this local installation, shared across sessions and retained after restart.
- **Approve for session**: allow this application for the requesting conversation only. Keep the grant across turns and REPL resets; clear it when the conversation ends or Cherry Studio exits. Do not inherit it into another conversation or a child session.
- **Reject**: reject the pending request without granting access or adding a permanent deny rule. A later request may ask again.

Use the native stable application identity, not its display name, process ID or guest-provided target string, as the grant key. If stable identity cannot be established, do not offer a reusable grant for an unverified target. Resolve identity without launching; after approval, require the launched target to match the approved identity.

When the requesting execution uses `bypassPermissions`, skip application consent and execute without an approval prompt. Bypass does not create remembered grants. Returning to an ordinary permission mode restores the application-consent check. Existing operating-system permissions, the explicit Computer Use off switch, user stop controls and application ownership continue to apply.

`ComputerUseService` enforces access at the common native boundary, including operations on already-open handles. Runtime adapters supply trusted conversation identity, current permission mode and the existing approval request/response bridge; REPL code cannot supply these values. Persistent grants belong to Preference; conversation grants are main-process runtime state. Reuse the existing approval registry and presentation flow with explicit application identity and decision scope, rather than deriving grants from generic tool approval. Cover every built-in Computer Use entry point, including Agent runtimes and Assistant topics; an interactive execution without a usable approval responder fails without native access.

Concurrent requests for the same conversation and application share one pending approval. Cancellation or conversation disposal retires the pending request; a late answer cannot resume a cancelled operation or create a grant. A cell touching another application must independently obtain that application's consent before accessing it. Add a saved-application list to Computer Use settings so the user can remove an Always grant; subsequent access, including through an existing handle, must check permission again.

This is a new authorization decision alongside the existing [application identity presentation](../../implemented/feature/2026-11-10-computer-use-app-icons.md); the existing note continues to own icons and call metadata.

## Alternatives considered

- Keep the default off: retains the extra setup step instead of the requested application-level consent flow.
- Approve only the outer REPL tool: cannot constrain applications selected later inside the cell.
- Remember grants by display name or native process ID: conflates different applications or loses consent on relaunch.
- Treat Reject as permanent denial: adds a persistent block the user did not explicitly choose.

## Acceptance criteria

- AC1 — An unset Computer Use preference enables the capability; an explicitly disabled preference remains disabled. (verification: unit)
- AC2 — First access to an unapproved application shows its resolved identity and Always, Approve for session and Reject before launch, observation or input; Reject produces no target-side effect. (verification: unit and Electron)
- AC3 — Always survives restart and applies across conversations only to the approved identity; removing it in settings requires renewed consent even for an existing handle. (verification: unit and renderer)
- AC4 — Session approval survives turns and REPL resets, never authorizes another conversation or child session, and expires at conversation disposal or application exit. (verification: unit)
- AC5 — Bypass executes without application prompts or saved grants; leaving bypass restores consent checks while native permissions, explicit disablement, stop controls and ownership retain their contracts. (verification: unit and Electron)
- AC6 — Multi-application cells ask independently; concurrent duplicate requests share a prompt; cancellation and late responses cannot execute or save consent. (verification: unit)
- AC7 — All built-in Computer Use adapters enforce the same application policy; approval UI and settings use translated strings and existing UI components. (verification: unit, renderer and Electron)

## Risks

Stable identities must be verified against the installed SDK on each supported platform. A missing pre-launch identity capability requires an upstream SDK improvement, not launching the application to discover what was approved. Existing installations may have persisted the old default as false; this proposal deliberately does not infer that a stored false was accidental.

Approval can suspend a host call inside a running REPL cell. Cancellation, execution timeouts and runtime approval projection need integration coverage so waiting for a person neither loses the request nor executes after cancellation. Broad Always grants are intentional and must remain inspectable and removable in settings.
