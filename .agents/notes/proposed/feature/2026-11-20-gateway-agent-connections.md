# Agent Note: Agent connections through the API gateway

Status: proposed

English | [中文](2026-11-20-gateway-agent-connections.zh.md)

## Problem

External clients need an address for their protocol and the model ID the gateway accepts. Local model clients currently need a gateway key, and the LAN listener admits only the encrypted device-pairing transport.

## Proposal

The shared gateway panel shows four copyable URLs for Base URL, OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages. The model list copies the exact provider-qualified ID accepted by the gateway. Copy remains available while the gateway is stopped, and running URLs use the actual bound port.

Loopback model clients can make requests without a key. LAN model sharing is off by default and requires a gateway key before the listener widens. The existing device pairing, internal listener, and model addressing contracts stay in place. Public model routes support OpenAI, Anthropic, and Gemini.

## Alternatives considered

Model aliases would add a second naming and configuration step for users who already enter model IDs in their client. A global authentication switch would couple local calls to LAN sharing, and using device pairing as the sharing switch would change network exposure for existing installations.

## Acceptance criteria

- AC1 — Settings and Launchpad show four copyable URLs while stopped and use the actual bound port while running (verification: Electron)
- AC2 — A real local socket can call the model API without a credential, and an untrusted browser origin cannot use that exemption (verification: HTTP integration)
- AC3 — LAN model calls require a valid key, and disabling sharing blocks LAN model calls without disabling device pairing (verification: HTTP integration)
- AC4 — Enabled LAN sharing shows copyable bound URLs and a masked key (verification: Electron)
- AC5 — The model list copies the same provider-qualified ID returned by the gateway model catalog (verification: renderer and Electron)

## Risks

Some external clients still require a credential field in their own configuration. Plain HTTP does not protect the API key against observers on the LAN.
