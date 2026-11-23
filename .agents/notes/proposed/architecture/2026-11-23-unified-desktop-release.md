# Agent Note: Unified desktop release and persistent region

Status: proposed

English | [中文](2026-11-23-unified-desktop-release.zh.md)

## Problem

Separate CN and international desktop packages tie runtime region to the installer even though both editions use the same profile location. A package consolidation must preserve signed-in accounts, local data and the trust expected by installed updaters.

## Proposal

Use the international package identity for the unified distribution. Keep package identity, update track and mirror selection independent of product region. Reuse the installed profile and its custom location mapping.

Restore a signed-in account from its trusted stored API origin before opening product windows. Keep authorization, refresh, subscriptions, notifications and regional UI in that region. Preserve it as the profile region on logout or expiry. A legacy compatibility build retains its original package identity and persists the origin only after the old service confirms the session. Require original-region sign-in when an expired or ambiguous legacy session cannot be restored.

For a profile without a confirmed region, ask Config Service's anonymous `POST /v1/resolve` as `community_desktop` with platform and version, using the app proxy and a two-second startup deadline. Persist the region and provenance in the existing application state table. On failure use mainland China time zone, then explicit system region, then the first preferred language's explicit region, and finally GLOBAL. Mark a local inference provisional. A subsequent successful resolution takes effect at the next launch. New sign-ins confirm the region with Config Service and pin the authorization to that region. Installed providers and models remain available across region decisions.

Continue serving compatible targets at legacy update paths. Windows keeps the existing NSIS GUID. Linux AppImage uses legacy manifests and DEB/RPM keep package upgrades. On macOS, serve a signed and notarized CN bridge with the legacy identity. The bridge's pinned Squirrel.Mac build recognizes the exact international bundle identity and retains native signature verification against the legacy team and approved identifiers. The bridge checks the CN stable feed with an explicit package marker and preserves the saved track preference. Assign monotonically increasing versions across each path and publish the bridge only to legacy update clients.

Build the bridge by selecting an exact stable tag. Other packages at that tag preserve their existing installer identities and can backfill historical session origins. Only the CN macOS targets use the patched Electron distributions. Releases can select a newer validated bridge before the unified package is published. After signed acceptance, Releases can offer the selected higher unified version to the bridge. Unknown account origin does not hold back update checks.

## Alternatives considered

A redirect from the old Mac feed to the new ZIP fails bundle discovery and the legacy designated requirement. Separate ongoing releases keep both the build cost and the coupling to product region. Resolving region on every launch makes a stable profile depend on network changes.

## Acceptance criteria

- AC1 — Existing CN and GLOBAL sessions survive a signed upgrade and refresh in their original region even with opposite network egress or unavailable Config Service (verification: packaged artifact)
- AC2 — First resolution persists across launches, provisional offline decisions converge, and configured providers remain usable (verification: Electron)
- AC3 — Both Mac architectures complete both app updates, retaining data and rejecting wrong bundle identities, signers, tampered artifacts and downgrades (verification: packaged artifact)
- AC4 — Windows and Linux upgrade in place through appropriate legacy paths, and current international clients upgrade through their existing paths (verification: packaged artifact)
- AC5 — After six desktop region/platform registrations succeed and signed upgrade coverage is complete, release feeds and mirrors deliver one public artifact set while keeping legacy routes available (verification: packaged artifact)

## Risks

Confirm the six Config Service registrations before rollout. Verify an actual bridge build on both architectures against production-signed historical packages and check existing Keychain access and OS permissions. Release operations owns staged activation and can pause legacy rollout. Recover already-upgraded clients with a higher signed release.
