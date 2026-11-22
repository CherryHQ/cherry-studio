# Agent Note: Explicit Home retry and regeneration operations

Status: proposed

English | [中文](2026-11-22-chat-regeneration-operations.zh.md)

## Problem

[Issue #18616](https://github.com/CherryHQ/cherry-studio/issues/18616) asks for a clear failure-retry, regeneration and edit/resend chain. Its [focused Replace-or-Branch follow-up](https://github.com/CherryHQ/cherry-studio/issues/19038) adds explicit result preservation and effective-request visibility. Some reported behavior is older than the current source. Adding another retry loop or assuming every retained sibling contaminates context would regress existing guarantees.

This proposal owns ordinary persisted Home topic chat. It does not replace the [message-tree contract](../../../../docs/dev/references/chat/message-tree.md), [model retry owner](../../../../docs/dev/references/ai/model-retry.md), or [Agent history proposal](../architecture/2026-11-08-agent-history-operation-boundaries.md). Native Agent sessions, temporary append-only chats, workspace rewind, conversation-wide tree flattening and copying a branch into a new conversation are outside this delivery. The broader requests for per-assistant retry overrides and a user-selected retry interval remain explicit follow-up scope; completing this Spec alone must not close all of #18616 or #19038.

### Source-checked baseline

Baseline: `253bd3d400e40a9cb9afdd7a4f97ecd5bc5f9d63`. These are code observations, not a fresh Electron acceptance run.

| Area | Current owner and behavior |
|---|---|
| Home regeneration | `useChatWriteActions.ts` takes an explicit model override or current composer selection for non-pending targets; reasoning effort, service tier and fast mode can be inherited from the source turn |
| Failed assistant retry | `PersistentChatContextProvider.prepareAssistantRetry` validates topic/user/model, rebuilds history from the parent, re-admits immediately before resetting the exact row, and preserves the active-node pointer |
| Edit/resend | `handleForkAndResend` creates a user sibling and can retain direct multi-model reply IDs plus inherited turn controls; this is not a universal current-composer-settings contract |
| Context | `resolveCompactedHistory` starts from `getPathToNode(anchorMessageId)`; sibling retention alone is not evidence of context pollution |
| Retry affordance | `MessageGroupMenuBar` already offers retry for failed/paused/empty non-pending replies and deduplicates grouped retries by model; per-message discoverability still needs interaction verification |
| Automatic retry | `createRetryableWrap` and global `chat.retry.*` preferences already own bounded model-call retries, backoff, key failover and configured fallback; retries stop after streamed content and aborts are not retried |

Source owners are [Home operations](../../../../src/renderer/pages/home/hooks/useChatWriteActions.ts), [message actions](../../../../src/renderer/components/chat/messages/frame/messageMenuBarActions.tsx), [group retry](../../../../src/renderer/components/chat/messages/list/MessageGroupMenuBar.tsx), [Main context preparation](../../../../src/main/ai/streamManager/context/PersistentChatContextProvider.ts), [message persistence](../../../../src/main/data/services/MessageService.ts) and [model-call retry](../../../../src/main/ai/runtime/aiSdk/retry/createRetryableWrap.ts).

## Proposal

### 1. Give each operation a distinct meaning

| Operation | Effective request | History result |
|---|---|---|
| Retry failed reply | Same failed reply's model and saved supported turn controls; preview any current defaults that cannot be reconstructed | Reuse the eligible failed assistant identity; preserve branch selection and attachments |
| Regenerate, keep branch | Show current selected model(s) and effective supported controls; permit an explicit source-settings choice | Create a navigable sibling; only the chosen path enters the next context |
| Regenerate, replace | Same request preview, with an explicit replacement warning | On successful generation, replace only the confirmed eligible leaf reply; preserve unrelated siblings |
| Save and send edited user input | Show the edited parts, current selected model(s), effective controls and retained attachments | Create an edited user sibling and regenerate from that exact sibling; retain the original input branch |

Changing model is regeneration, not an in-place retry. Paused output and nonempty partial/tool output require an explicit restart warning; do not label them safe transparent retries. Missing historical controls are shown as inherited current defaults, never presented as an exact replay. Show every model for multi-model requests rather than silently collapsing to one model or reusing a paginated sibling list as intent.

### 2. Resolve once in Main and review before dispatch

Extend the existing typed stream admission/request boundary with a read-only operation preview. Main resolves topic/source ownership, parent anchor, model identities, effective supported controls, attachment references, retry policy summary, eligibility and affected reply identity. The renderer displays this projection through Home's adapter; shared message UI receives capabilities, not Home-specific state or page-mode flags.

Preview must not call `prepareDispatch`, reserve messages, reset a failed reply, run context compression, sync MCP tools, contact a provider or incur model charges. Extract side-effect-free resolution where needed instead of invoking execution to obtain a preview. Do not expose credentials, opaque provider headers or hidden prompt content. Show supported sampling controls and the existing reasoning/service-tier/fast-mode controls where applicable; identify defaults and omitted unsupported values honestly.

The confirmed action binds the preview's topic, source, parent, selected models, relevant configuration versions and operation mode. Main revalidates them and live-stream eligibility immediately before reservation/reset. A changed tree, model/configuration, attachment availability or eligibility rejects with a refreshable preview, not a silently different request. Successful dispatch records the effective controls on the resulting reply. Configured provider fallback remains governed by the retry owner and must be visible as a possible model change before submission and as the actual model afterward.

### 3. Keep replacement narrow and failure-safe

Keep the existing branch-preserving behavior as the initial default. Offer `Keep old reply as a branch` and `Replace current reply` in the regeneration review. An explicit saved default uses Preference and changes no existing topic on migration; it never bypasses request review or a destructive warning.

Initial replacement is eligible only for a successful, active-path assistant leaf with no live descendants, pending tool/approval work or competing execution. Multi-model replacement targets one explicitly selected reply, not the entire group. Older replies with continuations remain branch-only with a reason; do not silently reparent descendants or cascade-delete a conversation. Recheck eligibility at execution and at final publication.

Retain the original reply and selection until generation succeeds. The replacement intent belongs to the Main execution owner, not a renderer timer or optimistic delete. On success, atomically remove the confirmed old leaf through the persistence owner and select the successful new reply, preserving other branches and file-reference ownership. A pre-publication error/cancel preserves the original; any partial new output remains an honestly failed sibling. If success races with a new branch/configuration change or final replacement persistence fails, retain the successful new answer as a sibling, retain the old reply and explain that replacement was not applied. Never discard a generated answer to hide a publication failure. Restart does not resume destructive replacement automatically; existing interrupted-execution recovery remains authoritative.

### 4. Make retry visible without multiplying attempts

A failed reply has a keyboard-accessible, non-hover-only Retry action with a clear distinction from regeneration. While that reply has a live attempt, disable duplicate submission and expose cancellation. Retrying an off-path reply must not activate it. Preserve existing group deduplication, source file references, request ownership and attempt identity so late events from an older attempt cannot overwrite the current result.

Expose the existing global automatic-retry settings from the failure review rather than add a renderer whole-turn retry timer. Keep the current bounded count, backoff, Retry-After treatment, explicit opt-out, configured fallback and API-key-failover semantics at their current owner. Do not silently enable retry, replay completed tools, restart after partial streamed output, resubmit on reload or turn an unknown delivery outcome into a fresh automatic send. Configurable exact intervals or per-assistant overrides require a later change at that same owner, not a second loop around it.

### 5. Preserve source files and explicit edit choices

Home's edit/save-and-send review captures current model selection and effective controls at confirmation, rather than taking loaded historical reply order as a selection. An explicit source-settings choice is allowed and labeled. Preserve unchanged file parts and managed references; remove them only through the user's edit. Resolve references and target-model media/tool capabilities in Main before mutating the tree. Missing or inaccessible files and unsupported capabilities produce a named, actionable error without deleting the source branch or substituting another model silently.

The first user input uses the topic's virtual root just like later edited inputs. Keep existing branch-aware context and retained attachment rules. This proposal does not claim that an already-compacted transcript reproduces every byte of an earlier provider request.

### Delivery order

| Layer | Scope | Required evidence |
|---|---|---|
| A | Main-owned side-effect-free preview/resolution and typed admission binding | Ownership, stale preview and no-network/no-write regressions |
| B | Keep/replace reservation and success-only atomic publication | Real migrated SQLite, sibling/attachment integrity, failure and restart cases |
| C | Home action review, explicit retry and edited-send selection | Renderer interactions, all locale catalogs, responsive/keyboard checks |
| D | Existing automatic-retry integration, current guides and native acceptance | Retry-owner consumer tests and packaged Electron end-to-end checks |

Keep this note proposed through intermediate layers. Publish implementation above the Spec with the required stack workflow. No feature completion is inferred from a storage layer, mocked dialog or passing documentation gates.

### Partial implementation boundary

The first retry-source guard captures the failed reply's persisted ancestor path before asynchronous preparation. The final reset compares message identity, topic, parent, role, status, sibling group, model and saved data inside its write transaction. Changed reply content/controls, edited history or deleted/reparented ancestors reject before clearing the reply or descendant context anchors. Compaction summaries, usage/timing projections and unrelated sibling edits do not invalidate this content-path check. This adds two full-path reads and a comparison per explicit retry.

This guard is only part of AC1/AC2. It is not the read-only effective-request preview, a configuration/file-availability binding or a new retry UI. Existing context preparation can still write traces/compaction state or call a compression model before a stale source is rejected; the guard does not promise otherwise. Replacement, edited resend and native acceptance remain unfinished.

## Alternatives considered

- Delete the old answer before requesting a replacement: can lose a usable reply on provider failure or cancellation.
- Treat regeneration as in-place retry: hides a model/settings change and erases the retry identity contract.
- Add renderer auto-retry or resend on reload: multiplies existing retry counts and can replay tools or create duplicate charged requests.
- Rebuild context from every visible grouped reply: violates branch ownership and mistakes display grouping for active context.
- Introduce a global linear/tree conversion mode now: requires a separate destructive transition contract and is not necessary for explicit per-operation choices.

## Acceptance criteria

- AC1 — A Home failure offers a visible keyboard-accessible Retry action; duplicate live attempts are blocked; retrying an off-path eligible failure preserves model, supported saved controls, file references and active selection. (verification: renderer + Main integration + Electron)
- AC2 — Before regenerate or edited resend, review shows operation, effective selected model(s), supported controls/default origins, retained files and fallback possibility; preview causes no message writes, model calls, compression or tool sync. Stale confirmation changes nothing and requests a new preview. (verification: renderer + Main integration)
- AC3 — Keep-branch regeneration retains navigable siblings while the next provider input contains only the selected ancestor path, including virtual-root first-turn and multi-model cases. (verification: real SQLite + scripted provider payload + Electron)
- AC4 — Replace removes only the confirmed eligible old leaf after successful generation and atomic publication; unrelated branches and references survive. Error, cancellation, stale eligibility, publication failure and restart preserve old content and honestly expose any new sibling. (verification: real SQLite + stream failure injection + Electron)
- AC5 — Edited resend honors the confirmed current-model/control choice or explicitly selected source settings, retains unchanged attachments, and rejects missing/unsupported files without losing the original branch. (verification: renderer + Main integration + Electron)
- AC6 — Existing global automatic-retry counts, backoff, opt-out, failover/fallback and transient status remain single-owner; abort, partial streamed content and unknown delivery never trigger a new whole-turn automatic submission. (verification: retry-owner unit + stream integration)
- AC7 — English/Chinese user guidance and all changed locale keys describe supported Home modes, replacement eligibility, retry limits and Agent/temporary-chat boundaries; keyboard, narrow layout and light/dark native interactions are verified. Broader interval/override/flattening requests remain explicitly unfinished. (verification: docs gate + i18n + renderer + Electron)

## Risks

A successful remote request and SQLite replacement are not one transaction. Preserve both answers on publication ambiguity and never promise exactly-once provider execution. Existing message deletion can reparent descendants; replacement must not reuse that behavior without the stricter leaf guard. Review and dispatch can race with configuration changes, file cleanup, branch edits and another window. Multi-model groups and provider fallback require request and actual-result identities to stay separate. More prominent actions can cause extra billable requests, so preserve explicit confirmation and current opt-in retry limits. Native Windows/Electron acceptance remains required; source inspection and docs checks are not feature verification.
