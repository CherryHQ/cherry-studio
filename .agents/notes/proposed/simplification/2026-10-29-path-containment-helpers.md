# Agent Note: Collapse duplicated path containment predicates in the main process

Status: proposed

English | [中文](2026-10-29-path-containment-helpers.zh.md)

## Problem

The main process answers "is this path inside that directory" with twelve separate predicates. They disagree on four axes, and several of them guard security or data-safety decisions:

| Predicate | Arguments | Equal paths | Case folding | Child named `..x` |
|---|---|---|---|---|
| `isPathInside` — `src/main/utils/file/path.ts` | `(child, parent)` | outside | macOS + Windows | inside |
| `isSameOrInside` — `src/main/utils/file/path.ts` | `(candidate, container)` | inside | macOS + Windows | inside |
| `isPathInside` — `src/main/utils/legacyFile.ts` | `(child, parent)` | **inside** | none | **outside** |
| `isPathInside` — `src/main/services/userDataRelocation/validation.ts` | `(child, parent)` | outside | callers pre-fold | inside |
| `isPathInside` (private) — `src/main/core/security/validateSender.ts` | `(child, parent)` | **inside** | none | **outside** |
| `isPathWithin` — `src/main/utils/binaryEnv.ts` | **`(root, candidate)`** | inside | Windows only | **outside** |
| `isPathWithin` — `src/main/services/cacheCleanup/shared.ts` | `(target, root)` | inside | none | inside |
| `isInside` (private) — `src/main/ai/agentSession/fork/AgentSessionForkOperations.ts` | **`(root, file)`** | outside | none | **outside** |
| `isPathInsideOrEqual` (private) — `src/main/data/migration/v2/migrators/agentsFilesystemMigration.ts` | `(child, parent)` | inside | none on equality | inside |
| `isSameOrWithin` (private) — `src/main/ai/tools/moveToTrash.ts` | `(target, root, platform)` | inside | Windows only | **outside** |
| `isSameOrInsidePath` — `src/main/ai/toolApproval/userDataSqliteGuard.ts` | `(target, root, platform)` | inside | macOS + Windows | inside |
| `isCanonicalPathInside` — `src/main/utils/agentWebviewRequest.ts` | `(candidate, root)` | inside | none, by design | inside |

Three functions named `isPathInside` give opposite answers for `isPathInside(x, x)`. Two functions named `isPathWithin` take their arguments in opposite order. The copies that test `relative.startsWith('..')` misread a child whose first segment begins with `..` (for example `<root>/..x`) as outside the root.

Two of these differences let a path through a guard that should refuse it:

- **Agent `moveToTrash` protection.** `isSameOrWithin` decides whether a target lies in a protected directory (`~/.ssh`, `~/.aws`, `~/Library`, `/usr`, `/System`, `/etc`, Windows system roots, and so on). A target such as `/usr/..x/foo` or `~/.ssh/..x` gives `path.relative(root, target) === '..x/…'`, so the target counts as unprotected. On macOS the helper does not fold case, so `/USR/bin` or `~/LIBRARY/Preferences` (the same directories on a default case-insensitive APFS volume) also count as unprotected. `isDirectChild`, used for the mounted-volume-root check, has the same `..` prefix test. This shipped in v2.0.0.
- **Local backup directory validation.** The settings page (`LocalBackupSettings` through the legacy `App_IsPathInside` channel) and `AutoBackupService.validateLocalBackupDirectory` both use `legacyFile.isPathInside` to refuse a backup directory inside the app data or install directory. It accepts `<userData>/..backup`, and on macOS and Windows it accepts a case variant of the userData path, so backups can be written into the directory they back up.

The remaining divergences fail closed: they reject paths that are actually inside (sender validation, file operations limited to an allowed base, backup-restore escape check, Python runtime ownership, fork artifact ownership), or they misclassify a Cherry-managed binary as foreign (`BinaryManager`).

## Proposal

A containment check either grants something when the path is inside a root, or withholds something when it is. The two kinds need different case handling, so each call site uses the comparison that matches its kind:

- **Refuse-if-inside** guards (do not back up into userData, do not delete a directory holding userData, do not relocate into the source) fold case on macOS and Windows. Treating a case variant as the same directory can only make them refuse more.
- **Allow-if-inside** guards (a sender page belongs to the app bundle, a file operation stays under its allowed base, a binary belongs to Cherry's install, an artifact belongs to the fork) compare exactly on macOS and Linux. On a case-sensitive volume, a sibling whose name differs only in case is a different directory, and this refactor must not start trusting it.

Both kinds use primitives already exported from `@main/utils/file`. All of them match `..` only as a whole segment, and all of them take the container as the second argument (`path.relative` takes it first by Node's own signature):

- `isPathInside(child, parent)`: strict descendant, with case folding.
- `isSameOrInside(candidate, container)`: equal or descendant, with case folding.
- `!isOutsidePath(path.relative(container, candidate))`: equal or descendant. `path.relative` resolves both paths and compares them exactly on macOS and Linux. On Windows, `path.win32.relative` ignores case. That matches default NTFS, where a case variant names the same directory, and it is what these guards do today, so Windows behavior is unchanged.

The duplicates are removed and their callers are migrated as follows:

| Removed | Callers | Kind | Replacement |
|---|---|---|---|
| `legacyFile.isPathInside` | `ipc.ts` (`App_IsPathInside`, used by the backup directory setting), `AutoBackupService.ts` | refuse | `isSameOrInside` |
| `legacyFile.isPathInside` | `fileOperations.ts` (4), `LegacyBackupManager.ts` (symlink-escape check during backup copy) | allow | exact |
| `userDataRelocation/validation.isPathInside` | `validation.ts`, `execution.ts` | refuse | `isPathInside` (inputs are already folded; equality is handled separately) |
| `validateSender` private `isPathInside` | `isAppRendererUrl` (2) | allow | exact |
| `binaryEnv.isPathWithin(root, candidate)` | `BinaryManager.ts` (2), `pythonRuntime.ts` | allow | exact |
| `cacheCleanup/shared.isPathWithin` | `pathContainsActiveUserData` (2), `logs.ts` | refuse | `isSameOrInside` |
| `cacheCleanup/shared.isPathWithin` | `pathHasSymlinkedOwnedSegment` (walks the exact relative path afterwards) | allow | exact |
| fork `isInside(root, file)` | `AgentSessionForkOperations.ts` (2) | allow | exact, strict (`relative !== '' && !isOutsidePath(relative)`) |
| `isPathInsideOrEqual` | `isManagedLegacyAgentWorkspace` | allow | exact |

The allow-kind replacements keep today's decisions. The only exception is that a `..`-prefixed child is now inside. `isManagedLegacyAgentWorkspace` also stops folding case in the strict part, which it previously delegated to `isPathInside`.

`legacyFile.test.ts` loses its `isPathInside` cases with the function they test. `src/main/utils/file/__tests__/path.test.ts` gains the `..`-prefixed child and equality cases.

Three local predicates stay. Each has a distinct name, takes the container as the second argument, and already follows the rule above:

- `isSameOrWithin` (`moveToTrash.ts`) and `isSameOrInsidePath` (`userDataSqliteGuard.ts`) are refuse-kind and fold case. They take an injected `platform` and use `path.win32` or `path.posix`. Their tests depend on that to exercise Windows rules on POSIX hosts, and the shared helpers read the `isMac` and `isWin` module constants. `isSameOrWithin` and `isDirectChild` are fixed in place: `..` is matched as a whole segment, and case folding applies on `darwin` as well as `win32`, as `isSameOrInsidePath` already does.
- `isCanonicalPathInside` (`agentWebviewRequest.ts`) is allow-kind and compares already-canonical paths exactly, like the exact comparison in `src/main/ai/mcp/servers/filesystem/types.ts`.

The renderer `isPathInside` in `src/renderer/utils/path.ts` belongs to another process, matches the strict main-side semantics, and is documented as lexical and not a security primitive. It is unchanged.

Delivery is two implementation layers on this Spec. Neither depends on the other:

1. Consolidation: AC1–AC6.
2. `moveToTrash` fix: AC7.

Out of scope:

- Existing callers that already use the folding helpers for allow-kind checks, such as `McpResourceReadTool`, Claude Code `pathContainment`, `agentDataDirectory`, `agentWorkspaceStorage`, `DiagnosticBundleService`, `doctorTools`, and `cherryDocumentTools`. This Spec does not change their behavior. Auditing them against the rule above is separate work.
- Renaming the legacy `App_IsPathInside` channel and `window.api.isPathInside`. After layer 1 they have inclusive semantics under a name the renderer also uses for a strict helper. They leave with the legacy IPC migration.
- Five inline `relative.startsWith('..')` tests outside named helpers: `agentSessionWorkspace.ts`, `agents/prompt.ts`, `SkillService.ts` (2), and `KnowledgeMigrator.ts`. All of them reject on a match, so they fail closed.
- `normalizeForCompare` in `userDataRelocation/validation.ts`. It is still used by the rest of that module's validation.

## Alternatives considered

- Add a `platform` parameter to the shared helpers so `isSameOrWithin` and `isSameOrInsidePath` can collapse into them: every other caller would carry a parameter that exists only for two test seams, and those two still need `path.win32` on a POSIX host.
- Map `legacyFile.isPathInside` callers to the strict `isPathInside` to keep the name: those callers depend on equal paths counting as inside. A backup directory set to exactly the userData directory would then be accepted.
- Compare exactly, without case folding, everywhere: the refuse-if-inside guards (backup directory, cache cleanup, data relocation) need folding to recognise the same directory on a default case-insensitive volume.
- Fold case everywhere (the first revision of this Spec): on a case-sensitive macOS volume, the allow-if-inside guards would start trusting a sibling whose name differs from the root only in case. For `isAppRendererUrl`, that means trusting an HTML file outside the app bundle, which the source-trust gate in `docs/references/ipc/ipc-overview.md` forbids.
- Export a named exact predicate next to `isPathInside` and `isSameOrInside`: `isOutsidePath` is already the exported, documented exact primitive, and a third containment name would bring back the naming problem this Spec removes.
- Keep the copies and fix only the two fail-open sites: the same-name, opposite-semantics pairs stay, and the next caller picks whichever import autocompletes first.
- A lint rule banning `relative(...).startsWith('..')`: the five remaining inline sites fail closed, and a syntax rule does not catch the same mistake written as a string-prefix test.

## Acceptance criteria

- AC1 — `src/main` defines no path containment predicate other than `isPathInside`, `isSameOrInside`, and `isOutsidePath` in `@main/utils/file` and the three local predicates named in the Proposal; every migrated call site uses the comparison its kind requires, as listed in the Proposal table. (verification: typecheck + review)
- AC2 — `isPathInside` and `isSameOrInside` treat `<root>/..x` as inside, disagree only on equal paths (`false` and `true`), and treat a case variant of the root as the root on macOS and Windows. (verification: unit)
- AC3 — A local backup directory is refused, both from the settings page through `App_IsPathInside` and in automatic backup validation, when it equals the app data or install directory, lies inside it (including a `..x` child), or is a case variant of it on macOS or Windows. (verification: unit)
- AC4 — On macOS and Linux, sender URL validation rejects a `file:` URL under a sibling directory whose name differs from the app root only in case; on every host it accepts one under a `..x` child of the app root, and Windows case handling is unchanged. (verification: unit)
- AC5 — For ordinary inside, outside, and equal inputs, data relocation validation, sender URL validation, binary ownership, Python runtime lookup, cache cleanup, and the agents filesystem migration make the same decision as before, as asserted by their existing tests. (verification: unit)
- AC6 — Fork publication refuses an artifact whose source is outside the fork artifact directory and publishes one inside it. (verification: unit)
- AC7 — `moveToTrash` refuses a target reached through a `..`-prefixed segment under a protected directory (`/usr/..x/foo`, `~/.ssh/..x`) and, on darwin, a case variant of a protected directory (`/USR/bin`, `~/LIBRARY/x`), while ordinary workspace targets are still allowed and win32 results for paths without a `..`-prefixed segment are unchanged. (verification: unit)

## Risks

- Allow-kind sites keep exact comparison, so on a default case-insensitive volume they still reject a case-variant spelling of a path that really is inside. That is today's behavior and fails closed. Callers pass realpaths or paths built from the root, which already share its spelling.
- The argument order changes at the `binaryEnv` call sites and the fork check. In the exact form, the container is the first argument of `path.relative`. Every argument is a `string`, so the type checker cannot catch a reversed call. `BinaryManager` and `pythonRuntime` tests cover the first; fork ownership has no test today, which is why AC6 adds one.
- On Windows, a directory with per-directory case sensitivity enabled (for example, one shared with WSL) still lets an allow-kind guard trust a case-variant sibling. Today's code behaves the same way, and default NTFS volumes are case-insensitive.
- Each call site has to be classified by kind, and a wrong classification widens or narrows that one guard. The Proposal table records each classification so review can check it.
- Layer 1 touches about sixteen files, mostly import and call-site changes. Layer 2 is limited to `moveToTrash.ts` and its test.
