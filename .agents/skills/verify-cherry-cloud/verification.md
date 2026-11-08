# Cherry Cloud verification boundary

The comparison baseline is the merged stack at `b22aae1dd46d2cacae5c35dba95412a4420e42ab`. Business and external protocol contracts are preserved; confirmed races and misleading classifications are deliberate corrections. The exact implementation snapshot is recorded in `coverage.json`.

## Preserved computation and protocol

`contracts.mjs` compares TypeScript syntax trees, ignoring formatting and comments:

- Four unchanged security modules: `contracts.ts`, `crypto.ts`, `CherryCloudLoopbackCallback.ts`, and `CherryAccountCredentialStore.ts` under `src/main/services/cherryCloud/`.
- Fourteen existing model-feature, plan/catalog/quota and analytics schema declarations in `src/shared/ipc/schemas/cherryCloud.ts`. New local IPC envelopes are outside this identity comparison.
- The authorization creation and exchange request paths, bodies and response schemas in `CherryCloudService`.
- Eight unchanged service methods: `authenticatedFetch`, `activeSession`, `refreshSession`, `signedFetch`, `postJson`, `resolveRequestUrl`, `recordQuotaRefusal`, and `persistSession`.
- The entire entitlement/quota/model projection moved from `syncEntitledModelsOnce` into `projectEntitledModels`, with the same statements and inputs. Caller scheduling and scope admission are verified separately.

These identities establish preservation of those source computations. They assume the same imported primitives and equivalent inputs; they do not prove all new callers provide equivalent inputs, or that an external server implements the client contract. Existing signing, retry, credential, quota-floor and provider tests exercise the real preserved code offline.

## Bounded exploration of actual TypeScript

| Property | Actual owner and check | Bound |
| --- | --- | --- |
| A pending old click or closed window cannot submit a new portal; a flow submits at most once | `CherryCloudSubscriptionService.start/runIntent/openPortal/dispose`; `services/__tests__/CherryCloudSubscriptionService.exhaustive.test.ts` | Two ordered clicks, their independently delayed status replies, one shared login outcome, optional window disposal; 49 valid event orders for each of success/cancel/failure, 147 schedules |
| Replacing or disposing a window continuation cannot cancel another window's login | Same actual class and test | Two window-owner instances, shared login, first window disposed; the second still opens its own portal |
| Quota advice preserves every actual target; stale/unknown facts cannot assert exhaustion; another provider is not Cloud quota | `utils/cherryCloudTargetAdvice.ts`; `utils/__tests__/cherryCloudTargetAdvice.exhaustive.test.ts` | Two Cloud targets and one other-provider target; all 16 ordered subsets, eight exhaustion subsets and three freshness states, 384 partitions, plus unresolved fallback |
| Any known exhausted target defers the whole automatic item | `hasKnownExhaustedTarget` plus the actual Chat/Agent drain adapters | All target partitions above; composer tests preserve captured Chat targets and Agent's latest next-turn configuration |

The scheduler executes the real class, using the actual renderer IPC facade. It controls only external IPC replies and drains queued promise work between steps. Portal commands and analytics envelopes are observable effects, not internal mock counts. Main separately checks the managed sender and scope immediately before the actual browser call.

The finite scope does not cover arbitrary click counts, process crashes, arbitrary transport loss, operating-system browser delivery or all promise interleavings inside Main. It proves no unbounded liveness property. Main expiry/stop/cancellation and receipt/notification races have focused scheduled contract tests rather than a universal proof.

## Other implementation contracts

- Main login tests cover callback-before-browser-open completion and terminal settlement on cancellation, expiry and stop. Full refresh tests cover FIFO callers with first-request failure, per-caller scope/source/revision, stale queued work across another account, reconciliation failure and bounded stop.
- Receipt hook tests cover older initial replies, duplicate RPC/event revisions and account replacement. Plans retain last-known paid display while freshness gates marketing, quota advice and analytics. Account and settings tests cover active/upcoming success followed by 503 and stale unpaid retry.
- Notification tests exercise actual stream parsing, ready/catch-up failure, cancellation, cursor retention, growing backoff and reset after successful ready. Private server replay/retention semantics remain unverified.
- Generic selector tests cover distinct actions, keyboard activation, pin/selection exclusion, dynamic tags and affected consumer filters. `ownership.mjs` prevents Cloud policy returning to the generic selector or analytics transport, obsolete refresh paths returning, and product imports entering the portable Claude adapter.
- Queue tests distinguish submitted/deferred/failed, retain completion opportunities and drafts, prevent repeated deferred drains, and invalidate only an edited item's deferral when its payload is replaced. Chat and Agent retain their different target lifetimes.
- Real CLI rejection tests generate an ordinary quoted error and an actual 429 response, inspect native stored records, release the owner, and reopen a fresh owner. The adapter preserves the matching UUID's strict native rejection marker through cold/late/overflow observation; Main alone applies display wording. Ordinary 429 retry remains distinct from structured quota.
- Analytics formatter and transport tests preserve the existing event fields, identity, consent, anonymous/GeoIP policy, and stale-scope isolation. No event claims purchase causality.

## Deliberate break checks

`mutations.mjs` first runs passing controls. It then breaks real code for security primitive/shape identity, authorization body, protected request logic, entitlement projection, selector ownership, latest intent, disposal, duplicate portal invocation, shared-login cancellation, stale portal scope, stale quota, another provider's quota, dropped secondary target, edited-target wakeup, incomplete refresh receipt, and native cold rejection recovery. Each must produce an assertion counterexample, not an import/compiler failure. Originals are restored and controls rerun.

The mutation logs and original backups are local evidence, not files to publish. Run this again when maintaining the checks. A new property is not verified merely because its test passes: add a realistic broken variant that the test actually detects.

## Remaining acceptance

No live account/backend test environment was available. Signature enforcement, token rotation policy, real purchase/entitlement transitions, deployed SSE retention/ready semantics, PostHog arrival and full multi-window browser handoff require external acceptance. Focused tests, structural checks, native CLI replay, Electron UI evidence and remote CI are separate facts. The proposed Agent Note must not be marked implemented solely from these offline results.
