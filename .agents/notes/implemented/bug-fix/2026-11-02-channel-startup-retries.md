# Agent Note: Channel startup retries after connection failure

Status: implemented

English | [中文](2026-11-02-channel-startup-retries.zh.md)

## Problem

When Feishu's initial connection cannot resolve bot identity during a network outage, `ChannelRuntime` reports the connection failure and stops reconciling. The reconciler intentionally does not retry a failed target without another request, so restoring networking alone cannot restart the channel.

## Decision

`ChannelRuntime` retries failed `ChannelAdapter.connect()` attempts with exponential backoff, starting at one second and capping at 60 seconds. Retries continue while the desired channel state remains connected. Each failure publishes a disconnected status and its error immediately. An explicit reconciliation cancels the pending retry and resets the delay; a successful connection resets the delay, and disposal cancels the timer.

## Alternatives considered

- Retrying only inside the Feishu adapter would duplicate lifecycle ownership and leave the same startup failure mode in other adapters.
- Relying on another reconciliation request requires manual reconnect or an unrelated lifecycle event after networking returns.
- A finite retry budget can expire while the machine remains offline.

## Consequences

Persistent connection errors, including invalid credentials, are retried indefinitely at no more than one attempt per minute while the channel is desired. The status remains disconnected with the latest connection error while retries are pending. The timer is unreferenced and is cancelled when the runtime is disposed.

## Verification

- Regression — `pnpm test:main src/main/ai/channels/__tests__/ChannelRuntime.test.ts`: failed connections publish disconnected status, retry with exponential backoff, recover on success, and stop retrying when the channel is disabled.
