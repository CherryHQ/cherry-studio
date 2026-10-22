# Agent Note: Sandbox pending resource ownership

Status: implemented

English | [中文](2026-10-18-sandbox-pending-resources.zh.md)

## Problem

An MXC launch or exit that never settles leaves output queues open after incomplete cleanup. Consumers waiting for output cannot finish Stop or reach the manager's cleanup retry. Separately, RPC timeouts release the caller's slot while `vscode-jsonrpc` still retains its response promise, allowing unbounded accumulation. A `not-started` notification can also mask a startup error as cancellation. MXC 1.0.0 can settle `wait()` before caller-owned output reaches EOF; closing queues or disposing streams at that point silently loses tail bytes.

## Decision

Termination and cleanup have independent error handling: an SDK `kill()` exception must not bypass bounded output cleanup or strand consumers. Incomplete lease cleanup closes both output queues, preserves buffered bytes, and reports `OUTPUT_TRUNCATED`. The manager retains the failed instance and SDK resources for cleanup retries. Only an actual target exit triggers the `exited` path; preparation and spawn failures preserve their original readiness error and `startup-error` completion reason.

A spawn that resolves after stop or timeout still belongs to the lease. Errors from catch-path termination are contained so they cannot permanently reject the launch-settlement promise: startup failure and output closure settle, and a later stop can retry killing the retained child.

After confirmed exit, output collection and consumption continue until both pipes reach EOF and their queues drain, bounded by the smaller of `ioDrainTimeoutMs` and `cleanupTimeoutMs`. Only then are SDK streams disposed. Premature pipe closure, output-budget drops, or deadline expiry report `OUTPUT_TRUNCATED`, including when no bytes remain buffered.

The 32-request RPC bound counts unresolved transport requests, including timed-out or cancelled calls, until a response or disposal settles them. Caller deadlines still reject promptly. Accepted timeout values are integers from 1 through 2147483647 milliseconds.

## Alternatives considered

- Treating process completion as output EOF loses valid tail bytes. Waiting without a deadline can hang on inherited pipes or an absent consumer.
- Bounding output collection only in the application service leaves CLI and other package consumers exposed to the same hang.
- Disposing the entire RPC connection on any timeout interrupts unrelated calls. Retaining the transport slot keeps the connection usable within its bound.
- Releasing slots on local cancellation does not bound the underlying library's pending response promises.

## Consequences

Output after incomplete cleanup is intentionally unavailable; this does not imply the target stopped. Buffered output remains readable. A silent RPC peer can exhaust all slots, at which point new requests fail until responses arrive or the peer is disposed. Timeout does not prove a remote operation was cancelled.

## Verification

- Regression — `packages/sandbox/tests/contracts/lease.test.ts` covers preparation and SDK spawn errors, stalled preparation, bounded output collection, buffered output, and cleanup retries after exit. A throwing native kill under the real SDK verifies that collection settles with truncation while the instance stays failed and can later stop successfully without replacing its original completion. Delayed-spawn tests cover both explicit stop and startup timeout followed by repeated native kill failures, then successful termination after the error clears. It also uses the installed SDK's real `MxcProcess` with controlled native-driver streams to verify late stdout/stderr, premature closure, unread buffers, and drain/cleanup deadlines.
- Regression — `packages/sandbox/tests/contracts/peer.test.ts` uses real JSON-RPC stream connections to verify timeout/cancellation saturation, late-response recovery, pre-cancelled requests, disconnect settlement, and timer bounds.
- Regression — existing `tests/cli.test.ts`, `tests/rpc.test.ts`, `tests/contracts/instance.test.ts`, and `tests/contracts/manager.test.ts` in the sandbox package pass on macOS, including Node/Python callbacks. The unsupported-platform case is skipped on this supported host; Windows execution is not validated in this change.
