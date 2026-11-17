# Agent Note: Request sensitive input for Browser and Computer Use

Status: proposed

English | [中文](2026-11-17-automation-sensitive-input.zh.md)

## Problem

Browser and Computer Use can encounter passwords, verification codes and other secrets that only the user can supply. Asking for an ordinary chat message or an `AskUserQuestion` answer puts the value into model-visible conversation or tool data. A masked input alone does not change those delivery and persistence paths.

The current Automation REPL already supports transient application-consent requests and excludes their wait from its execution budget. Browser input binds a page and element, but its ordinary stale-reference recovery may select a replacement element. Computer Use provides element-based `setValue` and keyboard-based `typeText`; the latter does not bind the focused control. The installed SDK is pinned to `@cherrystudio/computer-use` 0.1.11. Its public protocol has no sensitive-input target or observation-protection contract. Newer upstream source must not be treated as an installed capability.

This is a separate decision from [application consent](2026-11-13-computer-use-app-approval.md) and [conversation browser ownership](2026-11-14-session-browser-tabs.md). Those notes retain their ownership. A reusable grant permits access to an application; it never supplies a secret or approves a different destination for one.

## Proposal

Provide one transient sensitive-input request lifecycle in Cherry Studio, initially consumed by target-bound Browser and Computer Use operations. Bash must be able to use the same request lifecycle later, but shell, stdin and PTY delivery are outside this Spec's acceptance scope. Do not add a secret vault, remembered values, clipboard transport or a generic model-readable secret API.

### Request and delivery

1. The model names an observed editable control and explains the purpose. Main resolves the actual destination and prepares a target binding before asking for a value; an unavailable or ambiguous target produces no input request.
2. Show a masked input card in the requesting conversation's composer with the verified website origin or application identity, window and field description, purpose, Submit and Cancel. Destination identity comes from the host. Model-authored purpose and page-authored labels are display data, never authority. Existing application consent precedes the sensitive request when required.
3. The value travels through a dedicated, sender-bound IpcApi response directly to the pending main-process operation. The operation validates the original target again, fills it once, and returns only a fixed outcome to the model. Neither the value nor a native target token enters the REPL, model tool arguments/results or ordinary approval `updatedInput`.
4. Main retires the request and releases value references after submission, cancellation or expiry. Submission consumes the request even when input fails; an uncertain action is never retried. A new request requires a fresh target observation and another user submission. Do not trim, normalize or interpret the supplied value as code or key chords; line-breaking input is rejected before dispatch so it cannot submit a form. Filling never automatically presses Enter or clicks Submit on the target.

Use the existing transient composer pattern rather than the ordinary question, draft-cache and persisted approval-response paths. A lifecycle service owns pending requests; shared schemas describe request metadata and responses. The renderer stores the value only in the mounted input, sends no value in change events, and clears it on submit, unmount or cancellation. An input draft is not restored after switching conversations. This is removal of retained references, not a claim of physical zeroization of JavaScript or operating-system memory.

### Target guarantees and upstream ownership

Browser preparation binds the existing conversation owner, guest/page binding, document, origin and exact DOM element. Submission rechecks them and the control's editability. Navigation, guest replacement or element replacement invalidates the request, including replacement with the same role and name. Sensitive input must not use automatic `recoverRef` retargeting. Focus-based page input additionally validates that the original element owns focus at dispatch; inability to enforce that condition must fail without sending the value.

Add the missing Computer Use contract in [Cherry Computer Use](https://github.com/CherryHQ/cherry-computer-use), including its generated SDK protocol and native implementations. Preparation produces a native, opaque target token bound to the private runtime, application session, process, window, exact control and selected input channel. Preparation returns promptly; it does not hold a native input request open while a person types in Cherry. Commit consumes the token once and revalidates the binding at the native input boundary. A changed focused control in the same window must not receive keyboard input. Supported element writes remain available without requiring focus when the native implementation can enforce exact control identity. Cancellation, stop, target disposal and runtime teardown invalidate tokens. Do not retarget by accessible name, fall back to another channel, use global typing or replay an uncertain write.

Native preparation must also establish observation protection for the target. Password controls are protected by classification before reading their value; explicitly selected secret/code controls receive the same protection even when they are ordinary text fields. The SDK reports this capability per platform. A backend that cannot enforce the contract returns an explicit unavailable/unsupported result before collecting a secret. Upgrade Cherry only to a published, matching SDK/native version after checking patches and compatibility; do not carry a host-only emulation or commit a local runtime symlink.

### Observation and confidentiality boundary

The supported guarantee covers the input card, host transport, exact target control and Cherry-delivered observations of that target. No raw value is written to messages, history, drafts, tool receipts, traces, diagnostics or logs. Errors expose fixed codes and destination metadata, not raw native/page error text that could echo input. Native and page services necessarily receive the value to perform the requested input.

Keep value, selected-text and editable-descendant content out of model-visible observations for a protected control. Protection survives the input request and subsequent turns until the backend establishes that the control is empty, removed or its document/window has been disposed. Cancelling an unfilled request does not erase values that already exist in the target. A failed or uncertain input retains protection.

While a destination remains protected, suppress screenshots of that page/window from model output rather than relying on potentially stale masking rectangles. Block unrestricted Browser `evaluate`, page-content extraction, WebMCP calls and inspection-buffer reads that could bypass field protection; keep permitted actions and filtered AX observations available. Computer observation suppression and field filtering belong in the upstream native contract. The local user can still see and operate their target. No model-provided flag, REPL reset, new handle or runtime adapter can remove protection. Release requires backend evidence, never a model assertion. After release, discard inspection entries collected during protection before allowing those reads again.

This does not promise that an arbitrary website or application cannot copy or transform a secret into unrelated content, persist it, or send it over its own network. Arbitrary destination-side echo and exfiltration are outside the guarantee; exact-string redaction cannot make that broader claim true. Do not advertise universal end-to-end secrecy.

### Waiting, cancellation and availability

Sensitive input is an explicit model-requested operation, not a claim that every password or code prompt can be detected automatically. Reuse the REPL's paused human-wait accounting for both surfaces, and verify cancellation and timeout propagation through each supported runtime. Start Browser command and native commit deadlines only after user submission. Each input request expires after five minutes independently of execution time. User stop, revoked capability, closed conversation/window/target, runtime completion and shutdown retire it; late or duplicate submissions cannot fill anything. Bind responses to the requesting window, conversation and operation. Requests from another conversation are independent and never inherit a value.

An application grant, `bypassPermissions` and automatic tool approval cannot bypass user input or target validation. Non-interactive and channel-linked executions without an authorized responder fail without collecting a secret. Preserve ordinary Browser/Computer behavior outside protected destinations. Use translated copy and `@cherrystudio/ui` components.

### Delivery and verification owners

After current-head Spec approval, implement and verify the upstream target/observation capability first, then integrate the published SDK into Cherry's request lifecycle, Browser and Computer adapters, and composer. Upstream owns native identity, input-channel guarantees, password classification and Computer observations. Cherry owns conversation/window authority, requests, Browser targets/observations, model-visible results and lifecycle integration. Upstream fixes and release evidence are linked from the implementation PRs. Bash's later adapter requires its own delivery contract and acceptance evidence; this stack does not claim to deliver it.

## Alternatives considered

- Ordinary chat or `AskUserQuestion` with a password input: masks presentation while preserving model-visible answers and draft/history storage.
- Return plaintext or a general secret lookup handle to the REPL: lets model-authored code print, redirect or retain it independently of the verified destination.
- Type into whichever control has focus after the user replies: application/window validation does not prove control identity.
- Emulate missing native guarantees in Cherry with click-then-type or a dependency patch: leaves the race at the native boundary and bypasses the upstream owner.
- Mask screenshot rectangles and redact matching strings everywhere: stale geometry and transformed or copied content cannot establish universal confidentiality; suppress risky observations instead.

## Acceptance criteria

- AC1 — An interactive Browser or Computer request displays the verified destination and a masked, cancellable composer input; ordinary chat/question caches, saved grants and bypass mode cannot supply or reveal its value. (verification: renderer and Electron)
- AC2 — A synthetic secret reaches the selected target unchanged once, produces only fixed model-visible outcomes, and is absent from REPL code/state, model requests/results, message/history/draft storage, logs, traces and diagnostics on success and failure. (verification: unit and Electron)
- AC3 — Browser navigation, guest or element replacement, changed origin and incorrect input focus reject the pending write without sending the secret, including a replacement with the same accessible name and role. (verification: unit and Electron)
- AC4 — Upstream native preparation/commit rejects cross-session tokens, changed process/window/control/channel, same-window focus changes, repeated commits and commits after cancellation or stop; supported exact-control writes fill once without retargeting or fallback. (verification: upstream unit and native fixture)
- AC5 — Password and explicitly protected code/text controls omit values, selected text and editable descendants from every supported Computer observation path before those values are read; unsupported platforms report the missing capability before requesting input. (verification: upstream unit and native fixture)
- AC6 — Protected Browser/Computer destinations emit no model-facing screenshots; filtered AX remains usable, Browser bypass reads are blocked, reset/new handles do not remove protection, and release requires backend evidence with protected inspection buffers discarded. (verification: unit and Electron)
- AC7 — Waiting at least 90 seconds preserves the live request and remaining execution budget; the five-minute expiry, cancellation, revocation, target/conversation/window closure and shutdown prevent late or duplicate submissions from sending input. (verification: unit and Electron)
- AC8 — Requests and responses remain bound to their window, conversation and operation; other conversations cannot answer or consume them, and executions without an authorized interactive responder collect no value. (verification: unit and Electron)
- AC9 — Claude, Pi, Pi Durable and Assistant topic adapters share the same input/protection policy, retain existing stop and application-consent behavior, and present translated copy through existing UI components. (verification: unit, renderer and Electron)
- AC10 — Cherry consumes matching published SDK/native artifacts with no local-link or host-emulation dependency; each platform advertised as available has native fixture evidence, and unverified GUI/platform scope is recorded explicitly. (verification: packaged artifact and native fixture)

## Risks

Native controls and browser frameworks differ in whether an exact element can accept input without a focus race. A backend may need to report unsupported for some controls; that result must be distinguished from successful input. Five-minute waiting needs integration evidence beyond a kernel-only clock test. The temporary card must not accidentally enter ordinary approval persistence or error-reporting payloads.

Observation protection intentionally limits automation while a secret remains present. Filtered AX can support the next action, but a page/application that requires unrestricted scripting or screenshot-only interaction may remain blocked. The destination can copy secrets outside protected controls; that is an explicit confidentiality limit, not evidence that the delivery path is safe to weaken. Removing references does not guarantee memory zeroization. Real desktop and packaged-artifact evidence must remain distinct from mock, fixture and CI results.
