# Agent Note: Cherry Cloud ownership convergence

Status: proposed

English | [中文](2026-11-08-cherry-cloud-ownership-convergence.zh.md)

## Problem

The subscription stack has merged at `b22aae1dd46d2cacae5c35dba95412a4420e42ab`. Authentication, subscription clicks, refreshes, selector offers, queued submission and native error replay have overlapping coordination paths. Delayed callbacks can finish one login twice, an older click can replace a newer click, and a queued Chat item can be judged against the editor's current model.

The user authorized implementation of the previously discussed architecture and selected business-contract and external-protocol preservation, allowing confirmed defect fixes. This note records that scope; its proposed status does not claim a GitHub Spec approval or completed acceptance.

## Proposal

### Owners and dependencies

Keep `CherryCloudService` as the main-process owner of credentials, authorization completion, account generations, HTTP facts and refresh publication. Each renderer window owns its latest unsubmitted subscription intent; a component unmount does not cancel it, and replacing an intent never cancels another window's authentication. Main validates the current account scope and managed sender immediately before opening the trusted account portal.

Serialize full account refreshes with the existing `Sequencer`. Each caller receives its own typed outcome. Publish one scoped, locally sequenced receipt with explicit endpoint freshness and reason. Lightweight provider authorization remains separate from sales-plan refresh. Notification cursors advance only after successful refresh for the same connection and scope. Renderer hooks project the receipt instead of refetching independent mirrors or guessing notification provenance from elapsed time.

Keep the generic model selector unaware of Cloud plans, authentication and analytics. Cloud composition supplies real-model presentation and distinct action rows. Offers cannot be selected, pinned or submitted as models. Preserve filtering, keyboard navigation, virtualization and general/agent differences.

Chat evaluates the models in each queued payload. A queued new Agent turn resolves the latest Agent configuration at launch; an active turn keeps its captured target. Deferred items remain queued without a drain loop. Unknown or stale availability is not evidence of exhaustion. Existing provider entitlement checks and the server's quota decision remain authoritative.

The portable Claude adapter owns validated live and archived native rejection facts. Product code decorates those facts without inferring errors from message text. Generic analytics owns consent and transport; a Cloud formatter owns Cloud identity and event properties. No global subscription manager, second session owner, durable flow ledger or new database table is introduced.

### Preservation and deliberate corrections

Preserve PKCE/state/loopback validation, signed requests, credential persistence before session publication, token-refresh single flight, waiter cancellation, local-first logout, retry/idempotency rules and quota-refusal floors. Preserve HTTP methods, paths, query/body fields and response parsing; public and account plan DTOs remain distinct. Preserve existing model row identity, active/upcoming semantics, edition behavior, six subscription sources, flow parameters, consent and coarse attribution.

Deliberate corrections are one terminal login/intent result, latest-click precedence, no stale-account portal or receipt, retryable failed notification refresh, queued-payload target evaluation, distinct quota and ordinary rate limits, accurate dynamic Free filtering, and no fabricated unsubscribed state while plans are unknown. These corrections must have code-backed counterexamples and contract tests. They do not authorize new checkout behavior or new analytics event values.

### Verification boundary

Use the merged commit above as the immutable comparison baseline. Verify preserved observable business and wire contracts, not incidental calls or existing defects. Check bounded concurrent event orders against explicit invariants and exercise actual TypeScript paths with controlled scheduling and generated inputs. Demonstrate that deliberate broken real-code variants fail the checks, then restore and rerun them. Record covered files, functions, bounds and the verified commit in the PR's verification evidence.

Offline endpoint fixtures and native SDK tests do not establish live backend compatibility. Local receipt sequence is not a server transaction revision. A model-checking pass does not prove unmodeled JavaScript, operating-system browser behavior or server implementation. Report these limits alongside focused tests, type checks and Electron evidence.

## Alternatives considered

- Centralize subscription, model policy and runtime execution in one manager: introduces a second owner across independent lifecycles. Retain existing owners and narrow contracts.
- Keep status listeners and independent SWR fetches with more guards: preserves duplicate completion and freshness writers. Make operation completion and refresh receipts explicit.
- Require exact buggy trace equivalence: would retain known races. Preserve business and external contracts with enumerated, verified corrections instead.

## Acceptance criteria

- AC1 — Authentication has one terminal outcome for every waiter across callback, cancellation, expiry and shutdown; browser-open races cannot contradict a persisted successful session. (verification: scheduled main-service tests; owner: main Cloud)
- AC2 — Only the latest unsubmitted window intent may open a portal; supersession, window disposal and stale account scopes prevent late side effects without cancelling shared login. (verification: exhaustive bounded schedules and IPC boundary tests; owner: renderer Cloud/main IPC)
- AC3 — Every admitted refresh settles independently, failed predecessors do not discard successors, and stale account results cannot publish. Receipt freshness and source are explicit. (verification: main-service concurrency and renderer projection tests; owner: main/renderer Cloud)
- AC4 — Notification ready/live/catch-up failure and cancellation retain retryability and never acknowledge an unprocessed account change. (verification: offline SSE scripts; owner: Cloud notifications)
- AC5 — Generic selector code has no Cloud policy imports; offers are action rows excluded from model selection and pinning, with keyboard/filter behavior preserved. (verification: dependency and selector consumer checks; owner: renderer selector)
- AC6 — Chat queue advice follows captured targets, Agent launch follows its existing configuration lifetime, and deferred drain wakes only on meaningful changes. Unknown facts do not create a quota decision. (verification: queue and affected composer tests; owner: conversation runtimes)
- AC7 — Trusted quota, rate-limit, authentication and entitlement failures remain distinct; native live and cold replay expose equivalent validated rejection facts. (verification: error contract and actual SDK/local-endpoint tests; owner: runtime adapters/product decoration)
- AC8 — Cloud analytics formatting leaves generic transport while preserving consent, source/flow contracts and account isolation; no event claims purchase causality. (verification: analytics formatter/consent tests; owner: analytics/Cloud)
- AC9 — Preserved security and HTTP contracts pass focused baseline/after checks; every verification property detects a deliberate real-code break. Bounds and backend limitations are documented. (verification: focused test files and recorded baseline/mutation evidence; owner: implementation coordinator)
- AC10 — All old coordination paths and orphaned APIs introduced by this migration are removed, affected consumers compile, and bilingual documentation matches the final implementation. (verification: explicit scope, dependency scan, focused tests, type checks and documentation gates; owner: implementation coordinator)

## Risks

- No live backend environment is available. Private ready-frame and analytics assumptions must remain explicit; local contract checks cannot certify server deployment behavior.
- Account, plans and models are separate observations. Failed reads preserve stale facts rather than manufacturing a current combined snapshot.
- Native archive metadata must be demonstrated from the pinned SDK's real producer and stored records before exposing a portable fact.
- Broad UI consumers make partial migration unsafe. Migrate each caller and delete obsolete paths within this change; keep unrelated behavior and files outside scope.
