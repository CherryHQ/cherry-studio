# Agent Note: Agent connections through the API gateway

Status: implemented

English | [中文](2026-11-20-gateway-agent-connections.zh.md)

## Problem

External clients need an address for their protocol and the model ID the gateway accepts. Local model clients currently need a gateway key, and the LAN listener admits only the encrypted device-pairing transport.

## Decision

The shared gateway panel shows four copyable URLs for Base URL, OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages. The model list copies the exact provider-qualified ID accepted by the gateway. Copy remains available while the gateway is stopped, and running URLs use the actual bound port.

Loopback model clients can make requests without a key. LAN model sharing is off by default and requires a gateway key before the listener widens. The existing device pairing, internal listener, and model addressing contracts stay in place. Public model routes support OpenAI, Anthropic, and Gemini.

## Alternatives considered

Model aliases would add a second naming and configuration step for users who already enter model IDs in their client. A global authentication switch would couple local calls to LAN sharing, and using device pairing as the sharing switch would change network exposure for existing installations.

## Consequences

Some external clients still require a credential field in their own configuration. Plain HTTP does not protect the API key against observers on the LAN.

## Verification

- AC1 — Electron Settings and Launchpad smoke: all four URL copies matched the configured port while stopped and the bound port while running.
- AC2 — `routes.integration.test.ts`: a real loopback socket accepts native keyless model requests and rejects requests from an untrusted browser origin.
- AC3 — `routes.integration.test.ts` and `lanLifecycle.integration.test.ts`: LAN requires a valid key and can be disabled independently of device pairing.
- AC4 — Electron LAN smoke: URL copies use the active interface and bound port, and the key field defaults to masked.
- AC5 — `ApiGatewayPanel.test.tsx` and the Electron model-list smoke: the clipboard receives the provider-qualified ID returned by `/v1/models`.
