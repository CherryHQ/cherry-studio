---
description: Native integration payloads, installer publication, and installed Windows acceptance for The Boss
sources:
  - .github/workflows/integration-payload.yml
  - .github/workflows/the-boss-release.yml
  - build/integration-sources.json
  - scripts/package-prometheus.js
  - scripts/update-release-entry.cjs
  - src/renderer/pages/settings/PrometheusSettings/IntegrationSettings.tsx
---

# The Boss integration release

The Boss uses **The Boss integration payload** followed by **The Boss Release**.
The upstream Cherry Studio release runbook describes a separate workflow. For this
integration release, the operator has authorized commits and publication and has
selected the installed Windows application as the functional acceptance boundary.
Do not run intermediate test suites, review loops, or standalone verification
builds. Fix compiler and packaging failures in the actual release builds.

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
5. Dispatch `the-boss-release.yml` from that committed source. Its six native jobs
   produce two Windows setup installers, two macOS DMGs, and x64/ARM64 AppImage,
   DEB, and RPM packages. Compiler checks inside the packaging commands are part
   of the build. Retain available signing configuration and report actual signing
   status in the release metadata.
6. Successful jobs publish installers through IPFS. The final job requires all
   ten artifacts from the same source commit before generating and committing
   `release-manifest.json` and the new `RELEASES.md` entry. Keep the source branch
   unchanged during this final build so the metadata commit can succeed.
7. In `Know-Me-Tools/boss-landing-spot`, generate download data from the completed
   release entry with `scripts/sync-release.mjs --file <RELEASES.md> --verify`.
   Commit it and publish the connected **The Boss Landing** Lovable project.
   Keep the previous complete release advertised until every new artifact exists.

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
