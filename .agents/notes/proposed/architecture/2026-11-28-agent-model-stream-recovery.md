# Agent Note: Recover interrupted Agent model streams

Status: proposed

English | [中文](2026-11-28-agent-model-stream-recovery.zh.md)

## Problem

Desktop Pi and Pi Durable send model requests through the internal Gateway. The Gateway retries transient errors before forwarding the first content part. If a model stream fails after forwarding content, Pi Durable records a failed generation because the desktop disables its native provider retries. Reopening the store recovers nonterminal work after process exit, so that recovery cannot pick up a generation already marked failed while the app was running. [Existing desktop retry policy](../../implemented/bug-fix/2026-11-19-subagent-retry-error-projection.md)

## Proposal

### Preserve failure information across the model boundary

Report connection failures, interrupted response streams, actual upstream HTTP failures, and cancellation through the trusted object transport. Keep the original transport code and whether an upstream HTTP error was received before converting the error into a provider envelope. A gateway-generated HTTP status or an unknown failure with no HTTP headers does not prove the provider returned that status or the machine is offline.

Keep the current Gateway retry policy for existing callers. For Pi Durable model calls that opt into recovery, hand the transport failures covered by the following table to the Harness without spending the Gateway retry budget on them. Other provider errors keep their existing policy. The Pi and Pi Durable bindings can share the failure classification. This delivery first enables recovery in Pi Durable. Ordinary Pi can adopt the same policy when its native loop can apply it while the session is alive. Claude Code projects the retries reported by its SDK and keeps its native execution policy.

### Retry the interrupted generation within its run

Use Pi Durable's existing generation retry checkpoint. Keep the run, submitted input, and committed tool results. Preserve abandoned output as an interrupted attempt, separate from the completed answer and omitted from the retry prompt. Build a new model request from the committed context on the same route. Incomplete tool calls from the failed attempt are never dispatched.

| Failure reported to the Harness                                                                           | Behavior                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit offline or network-suspend transport error                                                       | Persist the wait and retry the same generation with capped backoff until a new request succeeds, a different failure policy applies, or the user cancels. |
| Connection reset, premature stream end, or upstream stream idle timeout with no explicit offline evidence | Retry the generation within the existing Harness retry budget. Each attempt is classified again.                                                          |
| Actual HTTP error, explicit cancellation, permanent transport error, or unclassified failure              | Keep the existing Gateway, cancellation, or terminal error handling for that cause.                                                                       |

Reuse the current retry projection for the active run while keeping scheduling state in the Harness. System wake can advance a scheduled network attempt when the scheduler supports it. Only the response from the actual provider request establishes recovery. Cancellation invalidates a pending attempt. Retry scheduling and callbacks for an earlier attempt cannot start an extra request or settle a newer attempt.

## Alternatives considered

- Retry the whole stream in the AI SDK. Once output is forwarded, the SDK does not own the attempt boundary in native history or the lifecycle of tools already dispatched.
- Resend the user's message after wake. This creates another turn and may repeat actions that already took effect.

## Acceptance criteria

- AC1 — After the provider sends text and closes its stream before completion, the desktop Pi Durable run completes under the original input and run identity after a successful fresh model request. The second request excludes the unfinished output and includes previously committed tool results. The completed tool executes once. (verification: Electron, owner: Pi Durable runtime)
- AC2 — Explicit offline errors preserve a pending run while repeated connection attempts fail. A reset or premature end without offline evidence consumes a finite budget. HTTP authorization and TLS certificate failures keep their causes and never enter the offline wait. (verification: unit, owner: AI Gateway and Pi Durable runtime)
- AC3 — Cancelling a waiting run prevents later network attempts. Reopening the store after exit during a wait resumes the original pending generation without submitting a new user input. (verification: unit, owner: Pi Durable runtime)
- AC4 — Each recoverable transport failure consumes one Harness attempt. Existing Gateway handling of other errors and the Claude Code SDK's retry events stay usable on their normal entry points. (verification: unit, owner: AI Gateway and Agent runtime)

## Risks

- A replacement request can incur additional provider usage and may generate different text. Keep the partial output visibly associated with the interrupted attempt.
- Missing transport evidence must remain unknown. Treating every timeout or gateway-generated error as offline can leave a permanent failure waiting indefinitely.
