# Agent Note: Store release build outputs in Tencent COS

Status: proposed

English | [中文](2026-11-13-release-artifacts-in-cos.zh.md)

## Problem

The [Release workflow](../../../../.github/workflows/release.yml) uses Actions artifacts to transfer platform packages between jobs and to retain a complete archive. A previous GitCode sync downloaded and unpacked the archive before uploading a second copy to COS. In the v2.2.1 run, Ubuntu unpacked the 8 GB archive but multipart upload to the Shanghai endpoint failed. A later Ubuntu probe uploaded and verified 49 MiB over the COS global acceleration endpoint in 6.82 seconds. Production-sized transfers still require validation. [Release run](https://github.com/CherryHQ/cherry-studio/actions/runs/43267392049) · [Endpoint probe](https://github.com/CherryHQ/cherry-studio/actions/runs/43370677985)

## Proposal

Each platform and edition uploads its built release files from the build runner to the existing private COS bucket under `releases-sync/`, using the global acceleration endpoint. Use separate keys for each release, build run, platform and edition. Keep the files individually addressable. Write the platform inventory after its uploads complete. After all required uploads succeed, draft finalization records a complete inventory that references those objects and uses the Global files for the GitHub draft. A partial platform rebuild can reuse other platform entries from a complete inventory for the same source commit. It fails if that inventory is unavailable.

After GitHub publication, GitCode sync reads the selected complete inventory from COS and transfers individual Global and CN assets, publishing installers before update manifests. Sync-only resolves a COS-backed build by tag and source run. Preserve the published-release gate, and validate required files and manifest references at assembly. Use the inventory to select assets during publication and sync without downloading GitHub Release attachments for comparison.

Replace CN installer links in the build summary with time-limited access to the relevant private COS objects. Keep existing unrelated diagnostics and logs outside this change. Historical builds that predate COS staging keep their existing artifacts and require a separate migration if they need to use the COS sync path.

## Alternatives considered

Copying a complete Actions artifact to COS in the sync job repeats transfer and makes retries depend on the Actions download. HTTPS origin pull returned partial content without persisting the complete archive in this bucket. Uploading the existing files during build gives COS the per-file inputs directly.

## Acceptance criteria

- AC1 — A Windows, macOS and Linux release build uploads both editions directly to COS through global acceleration and creates no Actions artifact for release packages or release history (verification: GitHub integration by the release maintainer)
- AC2 — Draft finalization consumes the complete COS inventory and attaches only Global and shared files to GitHub, and a partial rebuild replaces only its platform from a same-commit baseline (verification: unit and GitHub integration by the implementation author)
- AC3 — GitCode sync and sync-only publish both editions from COS after GitHub publication, with installers available before update manifests and no complete Actions archive download (verification: GitHub integration by the release maintainer)
- AC4 — A failed upload leaves no complete inventory, a dry run previews the selection without writes, and CN summary links resolve only to available installers for the selected run (verification: unit and GitHub integration by the implementation author)

## Risks

Global acceleration adds transfer cost and must be verified on every release runner. COS lifecycle retention must cover the supported retry window, including objects referenced by a newer partial rebuild. Signed installer URLs grant temporary access to their holders, so link lifetime and workflow visibility must be checked before rollout.
