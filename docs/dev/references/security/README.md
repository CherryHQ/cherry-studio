---
description: Home for security reference docs covering safe main-process handling of untrusted network input
sources:
  - src/main/utils/remoteFetch.ts
  - src/main/utils/remoteUrlSafety.ts
---

# Security Reference

Security invariants for Cherry Studio's main process, which handles renderer-, assistant-, and provider-controlled input. Currently covers the rules for fetching untrusted URLs.

| Document | Purpose |
| --- | --- |
| [Remote Fetch Safety](./remote-fetch.md) | SSRF-safe rules for main-process fetches of untrusted URLs — DNS pinning, private-address and redirect rejection |
