# Agent Note: Select the published Claude binary on Windows ARM64

Status: implemented

English | [中文](2026-10-28-claude-windows-arm64-install.zh.md)

## Problem

Code Mate's bundled mise 2026.7.14 registry omits the Windows ARM64 override and requests windows-arm64/claude instead of win32-arm64/claude.exe. Correcting that URL fixes the 404 but retains the GCS dependency. The official CLI also publishes an ARM64 npm platform archive. Installing its parent npm package through mise's embedded installer produces a Windows shim that invokes Node on claude.exe and fails with ERR_UNKNOWN_FILE_EXTENSION.

## Decision

Windows ARM64 installs resolve the official @anthropic-ai/claude-code-win32-arm64 package metadata and pass the archive URL and SHA-512 digest to mise's existing HTTP backend. mise verifies and extracts claude.exe directly. No npm lifecycle scripts or Node runtime are needed. Metadata must match the requested package and exact version, and must supply a valid SHA-512 digest.

Installation and latest-version lookup honor the npm registry setting, including the existing China-region default. The official registry and npmmirror fall back to each other; an explicitly configured custom source remains exclusive. The canonical recipe remains claude, preserving managed installation identity, availability, update and removal. Other platforms and the separately pinned Agent SDK binary retain their existing acquisition paths.

## Alternatives considered

- Keeping the corrected GCS URL leaves mainland-China download reliability unresolved.
- Installing the parent npm package through the embedded npm backend generates the failing Node launcher. Rewriting that generated launcher would hide an upstream installer defect.
- Sharing ClaudeCodeBinaryService's SDK executable couples Code Mate's independent updates and removal to the application's pinned SDK version.
- Upgrading every bundled mise binary changes installation for unrelated tools and platforms.
- Rewriting E2E assertions or manually placing a binary leaves the broken user installation path intact.

## Consequences

Code Mate continues to resolve install versions dynamically. Unlike the Agent SDK's build-time lockfile digest, its integrity comes from the selected registry's package metadata, so that registry remains a trust boundary. Scoped-package URLs escape @ in TOML tool options because the pinned mise parses @ before decoding those options. A working old installation is reused until an explicit update or reinstall. Mainland-China direct-download reliability still needs verification on that network.

## Verification

- Regression — claudeArm64Install.test.ts and claudeNpm.test.ts cover platform archive selection, latest and exact versions, integrity validation, mirror failure fallback, custom-source exclusivity, and unchanged other-platform recipes.
- Local Windows ARM64 — an isolated real mise install downloads the npm platform archive and its generated shim prints 2.1.312 (Claude Code). A deliberately mismatched archive is rejected without changing the previous global selection.
