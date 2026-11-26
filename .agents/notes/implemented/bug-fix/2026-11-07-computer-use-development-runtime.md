# Agent Note: Resolve the installed Computer Use development runtime

Status: implemented

English | [中文](2026-11-07-computer-use-development-runtime.zh.md)

## Problem

MP-140 cannot query native permissions in a normal development installation. The central runtime path points to a manually copied `.context/computer-use-runtime` that does not exist, even though the SDK's platform package contains the signed runtime.

## Decision

Resolve the SDK from the application root, then resolve its platform-specific optional package from the SDK entry. Use that package's runtime directory, preserving the macOS app bundle. Resolve only when the path is requested so a missing optional dependency does not abort application startup. Packaged builds retain their existing extra-resources path.

## Alternatives considered

- Copying a binary into `.context` hides the dependency defect and creates an unmanaged prerequisite for developers.
- Resolving from the bundled main-process entry loses pnpm's SDK-relative optional dependency resolution.

## Consequences

Development uses the runtime installed with the SDK. A missing native package fails the feature lookup; it does not silently use an unrelated binary. No user-data migration or runtime download is introduced.

## Verification

- Regression — the installed-runtime contract failed before the fix because the executable was absent at the old path.
- Regression — verify the installed runtime is executable, missing optional packages do not prevent registry construction, and packaged macOS, Windows and Linux paths remain under extraResources.
- Electron MP-140 and Windows workflow validation remain pending.
