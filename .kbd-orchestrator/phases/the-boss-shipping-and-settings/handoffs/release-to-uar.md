# Release to UAR integration handoff

Updated 2026-09-23. This supersedes the original A1-only waypoint and the pre-release shipping plan's approval, IPFS, test-first and review-loop instructions. The operator approved complete implementation/publication and subsequently switched distribution to GitHub Releases. No new tests or builds were run for this reconciliation.

## Shipped baseline

- The Boss release metadata commit: `8344b485203427952716cd142da28c181162be61`.
- Version 2.1.3: ten installers across Windows x64/ARM64, macOS ARM64/x64 and Linux x64/ARM64; `release-manifest.json` records each artifact's actual source, size, checksum and signing status. No pending platforms.
- Release: https://github.com/Prometheus-AGS/the-boss/releases/tag/v2.1.3
- Website: https://the-boss.know-me.tools — publication completed in the preceding release session; landing repository commit `d7741fb847bc68b46d50f7e40fade3f7862b5b10`.
- Compass PR https://github.com/GQAdonis/compass/pull/7 merged as `a403339287c385d4fd48b42759f1e09045a0ac4d`; shipped source `d0b9e0fb3cc62a1985bd6a83c5b5ea7798d937f9` pins rmcp exactly 3.4.0.
- The shipped tool/skill source pins remain in `build/integration-sources.json`; preserve them while implementing UAR. Do not advertise newer working-copy skills as part of the existing release.

## Independent delivery dimensions

- Implementation: Compass A1 delivered; integration/release payload published.
- Publication: all ten installers and website published through GitHub URLs; IPFS is retired.
- Evidence: actual packaging/publication evidence is recorded in the release manifest and earlier release session. No claim of installed Windows success.
- Certification: **pending operator-installed Windows x64 acceptance**. The Compass child and parent delivery remain open for that acceptance; a report of failure reopens corrective work.

## Current integration position

Canonical coordinator: `/Users/gqadonis/Projects/prometheus/prometheus-skills-mini`. Active path: `the-boss-shipping-and-settings / the-boss-universal-agent-runtime`. Use `prometheus kbd --path <coordinator>` for mutations; the application worktree carries a linked snapshot, not a second project identity.

- The Boss: `/Users/gqadonis/Projects/prometheus/worktrees/the-boss-uar`, branch `feat/uar-agent-runtime`, fast-forwarded from `4fa57d6585` to released baseline `8344b48520`; no pre-existing local changes or branch-only commits. The application UAR driver is not yet implemented.
- UAR: `/Users/gqadonis/Projects/prometheus/worktrees/uar-the-boss-sidecar`, branch `feat/the-boss-sidecar`, observed HEAD `cd739e82`. Launch security landed in `e44846af`, followed by entry-point correction `037b37af` and recorded limitation `cd739e82`.
- `sidecar-launch-security`: implementation complete for its recorded current scope. Its existing evidence reports macOS ARM64 only; Windows/Linux are unverified. The global-MCP lock depends on the current persistence/settings-manager path; the fallback change carries the obligation to retain the lock on every new path. Do not describe that limitation as resolved.
- `sidecar-session-principal`: in progress; Cargo.toml and new principal/retention test files are uncommitted in the UAR worktree. They were left untouched. Eight remaining registered UAR changes are pending.
- UAR's own `runtime-harness-gap-closure` waypoint belongs to a separate run. Do not overwrite it or copy mini's project identity into UAR. This integration is coordinated by mini.

## Next work

Continue `sidecar-session-principal` in the existing UAR worktree, preserving its WIP. Continue the approved driver/AG-UI/A2UI/settings integration in The Boss worktree against this release baseline and the UAR contract. Carry the workspace-resolved Compass/filesystem MCP servers through UAR's run-scoped MCP contract. Keep release publication independent from pending installed acceptance. The operator's latest execution rule takes precedence: no intermediate test suites, review loops or standalone verification builds.
