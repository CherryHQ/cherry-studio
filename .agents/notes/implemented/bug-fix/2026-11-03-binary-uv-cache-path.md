# Agent Note: Isolated uv cache avoids spaced macOS build paths

Status: implemented

English | [中文](2026-11-03-binary-uv-cache-path.zh.md)

## Problem

BabelDOC installation can build PyMuPDF from an sdist. Its Unix build command interpolates cache-local source and interpreter paths into an unquoted shell command. The isolated install subprocess's `XDG_CACHE_HOME` sits under `userData`, which normally contains `Application Support` on macOS; uv's inherited cache path therefore breaks that command at the first space (#22853).

## Decision

The registry owns `feature.binary.data.uv_cache` at `CHERRY_HOME/cache/uv/<sha256(resolve(userData))>`. The resolved profile digest gives stable, separate cache identities without copying legal spaced profile suffixes such as `Dev Oslo` into the leaf. Registry construction stays preboot-safe, and `NO_ENSURE` prevents a lookup from creating an unused candidate. BinaryManager materializes the directory only when the isolated environment selects it.

`getBinaryIsolatedHomeEnv()` adds `UV_CACHE_DIR` only on macOS, when its returned `XDG_CACHE_HOME` contains whitespace and the registered candidate contains none. Otherwise its environment is unchanged: no fallback to the real home, temporary directory, symlink, or rewritten path. A spaced home or development root remains legal but may leave the build-path failure unresolved.

The existing shared isolated environment carries the selection to mise install/remove/query, managed Python, and post-install uv dependency enforcement. Installed-tool execution receives no injected override, and merging an execution environment preserves a caller's cache value. HOME/XDG, interpreter and installation locations, and the ambient-variable allowlist keep their existing behavior.

## Alternatives considered

- Relocating HOME/XDG, managed Python, or final tool environments widens the change beyond the observed cache-local operands.
- A platform cache directory, temporary fallback, or symlink introduces another ownership policy; `CHERRY_HOME` already supplies Cherry-owned profile containment.
- Overriding all platforms or only `mise use` changes unmeasured Windows/Linux behavior or splits the existing management cache policy.

## Consequences

Eligible macOS management subprocesses use a separate Cherry-owned cache outside `feature.binary.data`. Cache eviction and backup exclusion are not guaranteed. A selected cache directory's creation failure can affect management queries through the existing shared materialization path; no fallback masks it.

This accommodates the measured shell-path failure, without guaranteeing every native build or every legal pathname works. Intel PyMuPDF builds and full app-driven BabelDOC installation/translation are not verified by these unit and renderer tests.

## Verification

- Regression — `src/main/utils/__tests__/binaryEnv.macos.test.ts`: selects the registered cache for `Application Support`, preserves HOME/XDG, omits the override for a space-free source or whitespace-containing candidate, and preserves the execution boundary and caller cache.
- Regression — `src/main/core/paths/__tests__/pathRegistry.test.ts`: checks Cherry-home containment, stable/distinct resolved profile identities including `Dev Oslo`, and `shouldAutoEnsure('feature.binary.data.uv_cache') === false`.
- Regression — `src/main/services/binaryManager/__tests__/BinaryManager.test.ts`: verifies the selected cache in subprocess environments for mise, managed Python discovery, and post-install dependency enforcement while retaining interpreter/pin assertions.
- Regression — `src/main/utils/__tests__/binaryEnv.windows.test.ts`: a spaced Windows profile receives no override and retains its isolated APPDATA/LOCALAPPDATA paths.
