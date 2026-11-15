# Agent Note: Install the 64-bit Windows asset for managed CLI tools

Status: implemented

English | [中文](2026-11-16-windows-64bit-asset-selection.zh.md)

## Problem

On 64-bit Windows the managed CLI installer can install a 32-bit build, which then fails at run time with `STATUS_DLL_NOT_FOUND` (`0xC0000135`) and gives no hint that the installer chose the wrong architecture. The bundled mise (2026.7.14) treats `win32` and `win64` as OS tokens, not architecture tokens (`src/backend/asset_matcher.rs`, `OS_PATTERNS`), so a release publishing both `…-win32.zip` and `…-win64.zip` scores them identically and `pick_best_asset`'s tie-break — shorter name, then lexicographic order — selects `win32`. Upstream has not changed this, so the desktop app cannot rely on a mise upgrade.

## Decision

After a `github:` backend install succeeds on a 64-bit Windows host, read the installed executable's PE header. Only when it is a 32-bit i386 image, reinstall the same version once with an inline `matching_regex` restricted to 64-bit asset tokens (`win64`, `x64`, `amd64`, `x86_64`, `x86-64`, `64bit`, `64-bit`; arm64 hosts use `win-arm64`, `arm64`, `aarch64`). If that narrowed install fails, reinstall the plain spec so the already-installed build stays selected. Every step after the main install fails open: it logs and returns instead of turning a successful install into an error.

## Alternatives considered

- Waiting for an upstream mise fix leaves every affected install broken meanwhile, and the failure surfaces far from the installer.
- Always passing a narrowed `matching` breaks releases whose asset names carry no architecture token, which is a larger regression than this bug.
- Fetching the release asset list before installing duplicates what mise already does and adds token, rate-limit and offline handling to the install path.
- Refusing to install when no 64-bit asset matches would turn today's usable (if wrong-arch) install into a hard failure.

## Consequences

Each `github:` install on a 64-bit Windows host costs one local PE-header read. A wrong-architecture install costs one extra download; releases with no matching 64-bit asset keep today's behaviour and only log a warning. The detection only inspects the executable the shim resolves to, so a recipe whose runtime libraries are still mismatched after a correct executable is not covered.

## Verification

- Regression — `node_modules/.bin/vitest run --project main src/main/services/binaryManager`: 9 files, 301 tests passed, including the new PE-parsing cases and the reinstall/restore command sequences.
- Regression — the new cases fail when the guard call in `installWithMise` is removed (2 failed, 3 passed), so they pin the behaviour rather than the current implementation.
- Root cause — read from mise v2026.7.14 `asset_matcher.rs` (`pick_best_asset`, `score_os_match`, `score_arch_match`) and confirmed against the `LibreDWG/libredwg` 0.14 release asset list: the x64 pattern matches only `libredwg-0.14-win64.zip`.
- Not verified — end-to-end on a real Windows x64 host; this host is macOS arm64 and mise derives the asset target from the running platform, so `MISE_PLATFORM=windows-x64` cannot reproduce the selection.
