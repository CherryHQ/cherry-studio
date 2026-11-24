# Agent Note: Preserve safe Unicode characters in skill folder names

Status: implemented

English | [中文](2026-11-21-skill-unicode-folder-names.zh.md)

## Problem

`sanitizeFolderName` in `src/main/ai/skills/skillPaths.ts` replaced every character outside `[a-zA-Z0-9_-]` with `_`. Non-ASCII skill directory names of the same character length collapsed into identical underscore-only strings (for example, `剪口播` and `自进化` in CherryIN's `Chengfeng VideoCut Skills` both became `___`), causing installation to fail with `Conflicting skill folder: ___` inside collections and across unrelated skills in the managed library. In addition, `normalizeFolderKey` only called `.toLowerCase()` without Unicode NFC normalization, and `downloadSkillPackage` compared folder names with `.toLowerCase()` directly instead of `normalizeFolderKey`.

## Decision

- Normalize inputs in `sanitizeFolderName` with `.normalize('NFC').trim()`, strip NUL bytes, retain Unicode letters, combining marks, digits, `_`, and `-` (`[^\p{L}\p{M}\p{N}_-]` replaced with `_`), and drop leading combining marks.
- Return `''` for blank inputs (preserving existing empty-name rejection) and fall back to `skill-<sha256[0..8]>` when a non-blank input has no letters or digits left (for example, punctuation-only names such as `???` and `***`) so distinct punctuation names never collide as underscores.
- Truncate names over 80 Unicode code points via `Array.from` (never splitting UTF-16 surrogate pairs) and append `-<sha256[0..8]>` to prevent prefix collisions.
- Append `-skill` to Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, case-insensitive).
- Delegate `normalizeFolderKey` to `foldPathSegment` (`normalize('NFC').toLowerCase()`) and use `normalizeFolderKey` for collection folder deduplication in `cherrySkillMarketplace.ts`.

## Alternatives considered

- Keeping ASCII-only sanitization with a hash suffix for every non-ASCII name (`skill-<hash>`): avoids character-set differences but produces unreadable folder names in `Data/Skills/` and diverges from user-authored local Chinese skill directories already adopted by `reconcileSkills`.
- Allowing dots (`.`) inside sanitized names: would reintroduce leading-dot hidden directories, `.`/`..` traversal segments, trailing-dot Windows stripping, and reserved names with extensions such as `con.txt`. Replacing `.` with `_` preserves existing ASCII behavior and avoids those hazards.

## Consequences

- Existing ASCII folder names keep identical sanitized outputs; non-ASCII skill names preserve readable, distinct directory names across Windows, macOS, and Linux.
- Marketplace packages with equal-length non-ASCII member directories (such as `Chengfeng VideoCut Skills`) install, export, and uninstall cleanly.
- Existing marketplace installations stored previously under underscore-only folder names remain recognized as already installed by `sourceUrl` matching and can still be uninstalled by skill ID; local or GitHub reinstalls of a previously underscore-named skill will land under its new Unicode folder name rather than auto-migrating the old folder.
- Open PR #20478 also introduces Windows reserved device name handling in `skillPaths.ts`; whichever lands second will reconcile the shared reserved-name helper.

## Verification

- Regression — `pnpm test:main src/main/ai/skills/__tests__/skillPaths.test.ts`: 7/7 tests pass covering ASCII compatibility, distinct Chinese/Japanese/Devanagari names, NFD/NFC normalization, punctuation-only hash fallback, surrogate-safe long-name truncation, Windows reserved names, and `normalizeFolderKey` folding.
- Regression — `pnpm test:main src/main/ipc/handlers/__tests__/skill.test.ts`: 31/31 tests pass.
- Regression — `pnpm test:main src/main/ai/skills/__tests__/SkillService.test.ts`: 180/186 tests pass on Windows, including `installs, exports, and uninstalls marketplace collection members with equal-length Chinese folder names` and all 10 CherryIN marketplace tests; 6 pre-existing unrelated tests fail with Windows `EPERM` on `fs.promises.symlink`.
- Regression — Live spot check (temporary Vitest harness, removed after run) against `Chengfeng VideoCut Skills` (`04528359-491e-464c-8c0d-28a81b319cff`): all 3 discovered members (`剪口播`, `口播成片`, `自进化`) pass `downloadSkillPackage` without folder-name collisions.
- Regression — `pnpm exec oxfmt --check`, `pnpm exec oxlint --deny-warnings`, `pnpm exec eslint` on the 4 changed TS files and `pnpm typecheck:node`: all pass with 0 warnings and 0 errors.
