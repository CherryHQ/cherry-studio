# Agent Note: Install the 64-bit Windows asset for managed CLI tools

Status: implemented

English | [中文](2026-11-16-windows-64bit-asset-selection.zh.md)

## Problem

On 64-bit Windows the managed CLI installer can install a 32-bit build, which then fails at run time with `STATUS_DLL_NOT_FOUND` (`0xC0000135`) and gives no hint that the installer chose the wrong architecture. The bundled mise (2026.7.14) treats `win32` and `win64` as OS tokens, not architecture tokens (`src/backend/asset_matcher.rs`, `OS_PATTERNS`), so a release publishing both `…-win32.zip` and `…-win64.zip` scores them identically and `pick_best_asset`'s tie-break — shorter name, then lexicographic order — selects `win32`. Upstream has not changed this, so the desktop app cannot rely on a mise upgrade.

## Decision

After a `github:` backend install succeeds on a 64-bit Windows host, read the installed executable's PE header. The reader honours the declared `SizeOfOptionalHeader` and data-directory count (`NumberOfRvaAndSizes`) before trusting the CLR entry; truncated or malformed images are reported as unknown rather than 64-bit. Only when the executable is a 32-bit i386 image, reinstall once with an inline `matching_regex` restricted to 64-bit asset tokens (`win64`, `x64`, `amd64`, `x86_64`, `x86-64`, `64bit`, `64-bit`; arm64 hosts use `win-arm64`, `arm64`, `aarch64`). Before reinstalling, resolve the version actually installed and pin both the narrowed spec and the restoring plain spec to that concrete version, so `latest` or a fuzzy range cannot drift between the two commands.

Before forcing the replacement, copy the current version's readable install directory into a temporary directory under `app.temp`. Only proceed once that local backup succeeds.

If the narrowed install or its `reshim` fails, copy the backup back to the original install path, recreating the directory if it was deleted, and run `reshim`. This rollback requires no download. Only if local restoration also fails does the installer fall back to `mise use` with the pinned plain spec. If restoration itself fails, the log states that the narrowed asset selection may still be configured.

If the install path is unavailable or local staging fails, log a warning and skip the retry, preserving the usable installation. The whole add-on remains inside a fail-open boundary that logs and returns without throwing to the caller.

## Alternatives considered

- Waiting for an upstream mise fix leaves every affected install broken meanwhile, and the failure surfaces far from the installer.
- Always passing a narrowed `matching` breaks releases whose asset names carry no architecture token, which is a larger regression than this bug.
- Fetching the release asset list before installing duplicates what mise already does and adds token, rate-limit and offline handling to the install path.
- Refusing to install when no 64-bit asset matches would turn today's usable (if wrong-arch) install into a hard failure.

## Consequences

Each `github:` install on a 64-bit Windows host costs one local PE-header read. A wrong-architecture install incurs an extra download only if the retry runs; releases with no matching 64-bit asset keep today's behaviour when restoration succeeds and log a warning. If the current installation cannot be staged locally, the retry is skipped with a warning and the tool remains usable, potentially still as a 32-bit build. Rollback from the local backup does not depend on a download service. A failed restoration may leave the narrowed selection configured, which the log explicitly reports. The detection only inspects the executable the shim resolves to, so a recipe whose runtime libraries are still mismatched after a correct executable is not covered.

## Verification

- Regression — `node_modules/.bin/vitest run --project main src/main/services/binaryManager`: 9 files, 332 tests passed, including strict PE-header validation, concrete-version pinning, the fail-open boundary, the local staging rollback, the skipped retry when staging is unavailable, and reinstall/restore command sequences covering `reshim` and restoration failures.
- Regression — `node_modules/.bin/eslint src/main/services/binaryManager --ext .ts`: 0 errors; `node scripts/validation/run.mjs --all --group types`: passed. Both checks failed in CI before the test-file fixes and now pass.
- Regression — the three staging cases fail on the previous head b1ae5cb (3 failed | 256 passed), the rollback case failing with "mise did not report an installed version".
- Root cause — read from mise v2026.7.14 `asset_matcher.rs` (`pick_best_asset`, `score_os_match`, `score_arch_match`) and confirmed against the `LibreDWG/libredwg` 0.14 release asset list: the x64 pattern matches only `libredwg-0.14-win64.zip`.
- Not verified — end-to-end on a real Windows x64 host; this host is macOS arm64 and mise derives the asset target from the running platform, so `MISE_PLATFORM=windows-x64` cannot reproduce the selection.
