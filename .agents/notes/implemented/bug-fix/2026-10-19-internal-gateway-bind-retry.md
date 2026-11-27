# Agent Note: Bounded internal gateway permission retries

Status: implemented

English | [中文](2026-10-19-internal-gateway-bind-retry.zh.md)

## Problem

An internal gateway `listen` failure with `EACCES` immediately rejects all waiting consumers, even when another OS-assigned port could work. IPv4 can bind successfully before the same port is refused on IPv6. The failure alone does not establish which operating-system restriction caused it.

## Decision

The internal gateway makes at most three startup attempts for `EACCES` from `listen`, using `es-toolkit`'s bounded retry helper. Each attempt creates a fresh server with port `0`; the operating system selects the port, which is not guaranteed to differ from a previous attempt. Server startup finishes cleaning up failed listeners before rejecting. Concurrent consumers share one pending startup and its retry budget.

After exhaustion, consumers receive the final localized error with its original cause. The failed startup is cleared so a later request can try again. Other errors propagate immediately. The public gateway retains its configured port and manual recovery through Settings.

## Alternatives considered

- Requiring a new user request after every internal refusal misses recovery that another ephemeral bind can provide.
- Unlimited retries can stall consumers indefinitely under persistent loopback restrictions.
- Automatically changing the public port invalidates client endpoints and paired-device connection information.

## Consequences

Persistent permission restrictions still fail after three attempts. Retry changes only listener startup: it does not replay model requests, change public preferences, or enable the public gateway. No new delay policy or dependency is introduced.

## Verification

- Regression — `src/main/features/apiGateway/__tests__/ApiGatewayService.test.ts`: concurrent consumers recover within the shared budget, exhaustion retains the diagnostic and permits a later request, unrelated errors propagate immediately, and the public gateway still requires an explicit retry.
- Regression — `src/main/features/apiGateway/__tests__/server.test.ts`: controlled IPv6 refusals exercise real Node listeners, HTTP recovery and rebinding of every failed port after cleanup. The injected refusal does not establish the cause on the original Windows machine.
