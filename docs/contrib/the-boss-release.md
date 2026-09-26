---
description: Native integration payloads, serialized publication, and installed acceptance for The Boss
sources:
  - .github/workflows/integration-payload.yml
  - .github/workflows/the-boss-release.yml
  - build/integration-sources.json
  - scripts/import-uar-sidecar-payloads.cjs
  - scripts/package-prometheus.js
  - scripts/coordinate-release-publication.cjs
  - scripts/queue-release-publication.cjs
  - scripts/release-capacity.cjs
  - scripts/release-preflight.cjs
  - scripts/release-profile.cjs
  - scripts/update-release-entry.cjs
  - src/renderer/pages/settings/PrometheusSettings/IntegrationSettings.tsx
---

# The Boss integration release

The Boss uses **The Boss integration payload** followed by **The Boss Release**.
The upstream Cherry Studio release runbook describes a separate workflow. For this
integration release, the operator has authorized commits and publication and has
selected installed Windows x64 and Apple Silicon applications as the functional
acceptance boundaries.
Do not run intermediate test suites, review loops, or standalone verification
builds. Fix compiler and packaging failures in the actual release builds.

## Select the customer release profile

The release workflow is manually dispatched with an explicit frozen application
version and customer profile. `release_version` must match `package.json`, and a
version already associated with another source or profile is rejected. The
`non-uar` profile publishes Windows x64/ARM64 and macOS arm64/x64 with
`THE_BOSS_UAR_ENABLED=0`; it remains the emergency path when UAR sidecar payloads
are unavailable. The 2.2.2 dispatch defaults to `uar-enabled`; selecting the
emergency profile is explicit.

For a UAR customer release, dispatch the workflow with `release_profile` set to
`uar-enabled` and provide both immutable sidecar release record URLs. The workflow
imports and validates the complete Windows x64 and macOS arm64 payload set before
selecting jobs, repeats the import in each native job, and uses the explicit
`build:win:x64:release:uar` and `build:mac:arm64:release:uar` package scripts.
Those scripts set `THE_BOSS_UAR_ENABLED=1` for compilation, packaging, and package
validation. Package validation probes the installed sidecar payload before an
installer can be published, and release metadata must carry the same UAR profile.
An existing GitHub release tag can only be resumed with its recorded profile, so
switching between non-UAR and UAR requires a new application version and tag.
The UAR profile supports only Windows x64 and macOS arm64 until additional
sidecar payloads are published.

## Produce the payload and installers

1. Commit the complete production changes in each source repository. Freeze those
   revisions in `build/integration-sources.json` and the mini gitlink. The mini
   payload includes its scripts, libraries, references, agents, rules, templates,
   configuration, Docker assets, and Node dependencies, alongside every skill.
2. Dispatch `integration-payload.yml` with a new immutable `boss-tools-*` tag.
   Native Windows, macOS, and Linux runners build Compass, Rust Filesystem,
   Prometheus, and pk for x64 and ARM64. Compass enables `surreal-remote`; JSON
   and SQLite remain included. Node archives and parser sources have pinned
   checksums. Service jobs publish both architectures and combine their manifests.
3. Make both GHCR service packages public. Confirm the published manifests are
   readable anonymously so installed users do not need GitHub credentials.
4. Download the generated `integration-artifacts.json` into `build/`, then commit
   it. Never substitute placeholder hashes or URLs. Its source revisions, binary
   hashes, Compass skill archive, and image digests define the payload.
5. Set a new application version, then dispatch `the-boss-release.yml` from that
   committed source with the exact `release_version` and intended customer
   release profile. Version, profile, and source SHA are frozen before a draft
   release is created. Each native runner reports free disk, free/total memory,
   packaged payload size, and the immutable native payload identities before
   packaging. The non-UAR profile produces two Windows setup
   installers and two macOS DMGs. The UAR profile requires both sidecar release
   records and produces Windows x64 and macOS arm64 installers. Compiler checks
   inside the packaging commands are part of the build. Retain the separate
   Windows and macOS signing configuration and report actual signing status in
   the release metadata.
6. Each successful native job uploads its installer and an immutable
   `release-platform-v<version>-<profile>-<platform>-<arch>-<source>.json` asset to
   GitHub Releases. It then submits that asset to the single publication queue.
   Publication runs are serialized under `the-boss-release-publication`; native
   builds remain independent. The coordinator reloads the current branch, merges
   one idempotent platform record while retaining completed peers, and retries a
   changed branch head instead of overwriting newer metadata.
7. The coordinator makes the release public, downloads the installer, verifies
   its recorded byte size and SHA-256, and dispatches
   `boss_release_platform_published` to `Know-Me-Tools/boss-landing-spot`. The
   repository secret `REPO_DISPATCH_TOKEN` must be authorized to dispatch that
   repository. The landing receiver resolves the immutable manifest asset from
   the public GitHub Release, regenerates and deploys its release data, and
   verifies the public bytes before accepting the next queued platform.

For a failed native build, the payload workflow retains completed tool artifacts
and compiler caches. Its `reuse_native_run`, `native_tools`, and `reuse_image_run`
inputs allow completed payloads to be reused while rebuilding affected tools.
Publication still requires every tool/platform record. An `images_only` run can
repair service images independently.

## Installed Windows walkthrough

This walkthrough is for the operator's PC after downloading the published setup
installer for its architecture. A successful build does not complete acceptance.

1. Install and launch The Boss. Open **Settings → Prometheus**. Confirm the
   packaged skill inventory, tool versions, and command directory are displayed.
   Open a new terminal and run `compass --version`, `prometheus --version`, and
   `pk --version`. Use **Repair PATH** if registration needs repair.
2. Open two conversations with different workspace folders. In Prometheus
   settings, select each workspace and index it. Confirm each displays its own
   graph path and managed Compass and Rust Filesystem server names. Ask each
   conversation to use Compass and list files through Rust Filesystem; the
   second workspace must not inherit the first workspace's roots or graph.
3. Install the packaged skills into a workspace. Use a mini skill and a Compass
   skill from that workspace. Confirm pre-existing user-authored skills remain
   intact. `prometheus doctor` uses the packaged mini runtime and reports the
   installed configuration without requiring a Rust toolchain.
4. Select managed services, save the ports and model/provider configuration,
   and use setup/pull and start. Inspect status and logs for SurrealDB, memory,
   and liter-llm. Exercise stop and restart, then confirm stored data remains.
   External mode must connect to existing endpoints without managing containers.
5. Select remote Compass storage and index/query the workspace. Repeat with
   SQLite and JSON. With Automatic selected, stop the managed services and
   confirm the workspace uses its local SQLite graph. An explicit remote choice
   must report the unavailable connection rather than silently switch backends.
6. Run workspace diagnostics from settings. Inspect the individual MCP,
   filesystem, Compass, database, memory, and liter-llm results. Listening alone
   is not operational success. Save any actionable failure output for the fix.
7. Restart The Boss and a terminal. Confirm settings, workspace isolation,
   command availability, skills, and persistent service data survive restart.

Record the installer version and architecture with the operator's result. Any
reported failure requires a code fix, rebuilt installers, and refreshed release
and website data. Leave installed Windows acceptance pending until the operator
reports success.
