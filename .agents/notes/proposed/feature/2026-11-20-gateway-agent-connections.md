# Agent Note: Agent connections through the API gateway

Status: proposed

English | [中文](2026-11-20-gateway-agent-connections.zh.md)

## Problem

Clients need a reusable address for a model and protocol. The current model ID includes the provider ID, so replacing a model can require updates in every client. Local model clients currently need a gateway key, and the existing LAN listener admits only the encrypted device-pairing transport.

## Proposal

The shared gateway panel shows named model aliases before network settings. Each alias has a stable Base URL and an in-place model selector. Keep the `default` row available alongside custom aliases and create its binding when a model is selected. Save the alias separately from its target, so replacing a disabled or removed model keeps the client's URL working. Alias requests use the URL's target, and OpenAI and Anthropic bodies may omit `model`. Model discovery on the alias URL lists that alias. The existing unscoped routes still accept explicit model IDs. Offer copyable addresses while stopped and use the listener's bound endpoint while running. Loopback clients can call the model API without a key. LAN model API sharing is off by default, has its own persisted setting, and admits requests only after the main process has established a gateway key. Device pairing and the internal listener retain their existing authentication and route boundaries. The model API includes the OpenAI, Anthropic and Gemini model routes.

## Alternatives considered

A global authentication switch would force local clients to reconfigure whenever LAN sharing is enabled. Reusing device pairing as the sharing switch would change what an existing installation exposes after upgrade.

## Acceptance criteria

- AC1 — Both gateway entry points show clipboard-ready alias Base URLs and protocol endpoints, including while stopped (verification: Electron)
- AC2 — A real local socket can call the model API without a credential, and an untrusted browser origin cannot use that exemption (verification: HTTP integration)
- AC3 — LAN model calls require a valid key even while loopback calls work without one, and disabling sharing blocks LAN model calls without disabling device pairing (verification: HTTP integration)
- AC4 — LAN controls show the bound addresses and the masked key after sharing is enabled (verification: Electron)
- AC5 — Rebinding an alias changes the target of the same URL without a server restart, including for requests without a body model (verification: HTTP integration)
- AC6 — Alias routes follow the existing loopback and LAN admission rules and are available only on the public gateway (verification: HTTP integration)

- AC7 — Adding a custom alias leaves the default picker available, and configuring it creates a copyable URL that survives reload (verification: Electron)

## Risks

Some clients still require a model or credential field at configuration time. LAN clients must support the transport they are given. A LAN API key sent over HTTP is visible to observers on that network.
