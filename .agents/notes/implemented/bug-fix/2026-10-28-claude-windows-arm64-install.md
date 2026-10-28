# Agent Note: Select the published Claude binary on Windows ARM64

Status: implemented

English | [中文](2026-10-28-claude-windows-arm64-install.zh.md)

## Problem

Code Mate installs Claude through the bundled mise 2026.7.14 registry. Its HTTP recipe overrides the URL and binary name for Windows x64 only. Windows ARM64 falls through to `windows-arm64/claude`, which returns 404; the official manifest publishes `win32-arm64/claude.exe`.

## Decision

When installing the canonical `claude` recipe on Windows ARM64, BinaryManager supplies mise's native `url` and `bin` tool options for `win32-arm64/claude.exe`. The version remains a template resolved by mise. The registry's official manifest checksum verification remains enabled. Catalog identity, version discovery, installation inventory, removal, and all other platforms retain their existing recipes.

## Alternatives considered

- Upgrading all bundled mise binaries changes the installer for every tool and platform; this repair only fills the missing platform mapping in the pinned version.
- Replacing Code Mate's installation with the Agent SDK binary couples two separately owned runtime paths and changes their version management.
- Rewriting an E2E assertion or preinstalling a binary leaves the broken user installation path intact.

## Consequences

The override duplicates the upstream download prefix and must be reviewed when the pinned mise registry gains Windows ARM64 support. Native download and checksum handling stay owned by mise.

## Verification

- Regression — `src/main/services/binaryManager/__tests__/claudeArm64Install.test.ts`: the original recipe fails the published-artifact contract; latest and explicit versions select the ARM64 executable, while other platform recipes remain unchanged.
