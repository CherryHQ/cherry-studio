# Agent Note: Cherry Cloud ownership convergence

Status: proposed

English | [中文](2026-11-08-cherry-cloud-ownership-convergence.zh.md)

## Problem

The subscription stack has merged at `b22aae1dd46d2cacae5c35dba95412a4420e42ab`. Authentication, subscription clicks, refreshes, selector offers, queued submission and native error replay have overlapping coordination paths. Delayed callbacks can finish one login twice, an older click can replace a newer click, and a queued Chat item can be judged against the editor's current model.

The user authorized implementation of the previously discussed architecture and selected business-contract and external-protocol preservation, allowing confirmed defect fixes. This note records that scope; its proposed status does not claim a GitHub Spec approval or completed acceptance.

## Proposal

### Owners and dependencies

Keep `CherryCloudService` as the main-process owner of credentials, authorization completion, account generations, HTTP facts, refresh publication and the subscription operation. Renderer sends one subscription command. Concurrent clicks across windows share the existing in-flight operation; the first admitted request supplies portal attribution and sender until it settles. Sign-out releases the operation so a new account need not wait for an old browser call; late completion cannot release its replacement. Each click retains its own analytics event. Main validates the current account scope and managed sender immediately before opening the trusted account portal. Closing that sender prevents the portal without cancelling authentication shared with other callers.

Serialize full account refreshes with the existing `Sequencer`. Each caller receives its own typed outcome. Publish one scoped, locally sequenced receipt with explicit endpoint freshness and reason. Lightweight provider authorization remains separate from sales-plan refresh. Notification cursors advance only after successful refresh for the same connection and scope. Renderer hooks project the receipt instead of refetching independent mirrors or guessing notification provenance from elapsed time.

Keep the generic model selector unaware of Cloud plans, authentication and analytics. Cloud composition supplies real-model presentation and distinct action rows. Offers cannot be selected, pinned or submitted as models. Preserve filtering, keyboard navigation, virtualization and general/agent differences.

The follow-up queue owns drafts, ordering and submission handoff, without quota advice or account-change wakeups. Chat submits the targets captured in each queued payload. A queued new Agent turn resolves the latest Agent configuration at launch; an active turn keeps its captured target. Unaccepted submissions retain their drafts; accepted submissions leave the queue and subsequent execution failures belong to the conversation. Existing provider entitlement checks and the server's request-time quota decision remain authoritative. Quota recovery does not trigger automatic resubmission. A future recovery feature must use an explicitly registered scheduled task that enters the existing submission path; no such task is introduced here.

The portable Claude adapter owns validated live and archived native rejection facts. Product code decorates those facts without inferring errors from message text. Generic analytics owns consent and transport; a Cloud formatter owns Cloud identity and event properties. No global subscription manager, second session owner, durable flow ledger or new database table is introduced.

### Preservation and deliberate corrections

Preserve PKCE/state/loopback validation, signed requests, credential persistence before session publication, token-refresh single flight, waiter cancellation, local-first logout, retry/idempotency rules and quota-refusal floors. Preserve HTTP methods, paths, query/body fields and response parsing; public and account plan DTOs remain distinct. Preserve existing model row identity, active/upcoming semantics, edition behavior, six subscription sources, flow parameters, consent and coarse attribution.

Deliberate corrections are one terminal login result, one in-flight subscription operation across windows, no stale-account portal or receipt, retryable failed notification refresh, queued submission independent of the editor's quota state, distinct quota and ordinary rate limits, accurate dynamic Free filtering, and no fabricated unsubscribed state while plans are unknown. These corrections must have code-backed counterexamples and contract tests. They do not authorize new checkout behavior or new analytics event values.

### Verification boundary

Use the merged commit above as the immutable comparison baseline. Verify preserved observable business and wire contracts, not incidental calls or existing defects. Check bounded concurrent event orders against explicit invariants and exercise actual TypeScript paths with controlled scheduling and generated inputs. Demonstrate that deliberate broken real-code variants fail the checks, then restore and rerun them. Record covered files, functions, bounds and the verified commit in the PR's verification evidence.

Offline endpoint fixtures and native SDK tests do not establish live backend compatibility. Local receipt sequence is not a server transaction revision. A model-checking pass does not prove unmodeled JavaScript, operating-system browser behavior or server implementation. Report these limits alongside focused tests, type checks and Electron evidence.

## Alternatives considered

- Centralize subscription, model policy and runtime execution in one manager: introduces a second owner across independent lifecycles. Retain existing owners and narrow contracts.
- Keep status listeners and independent SWR fetches with more guards: preserves duplicate completion and freshness writers. Make operation completion and refresh receipts explicit.
- Defer queued drafts using client quota snapshots and wake them on account refresh: couples submission scheduling to cached business advice and duplicates the request owner's target resolution. Submit through the existing path and leave execution refusals with the conversation; scheduled quota-recovery retries remain out of scope.
- Require exact buggy trace equivalence: would retain known races. Preserve business and external contracts with enumerated, verified corrections instead.

## Acceptance criteria

- AC1 — Authentication has one terminal outcome for every waiter across callback, cancellation, expiry and shutdown; browser-open races cannot contradict a persisted successful session. (verification: scheduled main-service tests; owner: main Cloud)
- AC2 — Concurrent subscription commands across windows share one login/portal operation; the first admitted request supplies portal attribution, invalid senders and stale account scopes prevent late side effects, and closing a sender never cancels shared authentication. (verification: concurrent main-service and IPC boundary tests; owner: main Cloud)
- AC3 — Every admitted refresh settles independently, failed predecessors do not discard successors, and stale account results cannot publish. Receipt freshness and source are explicit. (verification: main-service concurrency and renderer projection tests; owner: main/renderer Cloud)
- AC4 — Notification ready/live/catch-up failure and cancellation retain retryability and never acknowledge an unprocessed account change. (verification: offline SSE scripts; owner: Cloud notifications)
- AC5 — Generic selector code has no Cloud policy imports; offers are action rows excluded from model selection and pinning, with keyboard/filter behavior preserved. (verification: dependency and selector consumer checks; owner: renderer selector)
- AC6 — Queued Chat submissions retain captured targets, Agent launch retains its configuration lifetime, and queue delivery does not depend on client quota snapshots. Unaccepted drafts remain queued, execution errors stop automatic advancement, and quota recovery alone never resubmits input. (verification: queue, submission-controller and affected composer tests; owner: conversation runtimes)
- AC7 — Trusted quota, rate-limit, authentication and entitlement failures remain distinct; native live and cold replay expose equivalent validated rejection facts. (verification: error contract and actual SDK/local-endpoint tests; owner: runtime adapters/product decoration)
- AC8 — Cloud analytics formatting leaves generic transport while preserving consent, source/flow contracts and account isolation; no event claims purchase causality. (verification: analytics formatter/consent tests; owner: analytics/Cloud)
- AC9 — Preserved security and HTTP contracts pass focused baseline/after checks; every verification property detects a deliberate real-code break. Bounds and backend limitations are documented. (verification: focused test files and recorded baseline/mutation evidence; owner: implementation coordinator)
- AC10 — All old coordination paths and orphaned APIs introduced by this migration are removed, affected consumers compile, and bilingual documentation matches the final implementation. (verification: explicit scope, dependency scan, focused tests, type checks and documentation gates; owner: implementation coordinator)

## Risks

- No live backend environment is available. Private ready-frame and analytics assumptions must remain explicit; local contract checks cannot certify server deployment behavior.
- Account, plans and models are separate observations. Failed reads preserve stale facts rather than manufacturing a current combined snapshot.
- An accepted submission may become a failed conversation message when the server refuses quota; it is not restored to the draft queue or automatically retried when quota recovers.
- Native archive metadata must be demonstrated from the pinned SDK's real producer and stored records before exposing a portable fact.
- Broad UI consumers make partial migration unsafe. Migrate each caller and delete obsolete paths within this change; keep unrelated behavior and files outside scope.
