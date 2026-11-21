# Agent Note: Refuse Agent workspaces inside the installation directory

Status: implemented

English | [中文](2026-11-09-agent-workspace-install-directory.zh.md)

## Problem

Issue #23938 reports that a Windows in-app upgrade removes an Agent work directory such as `D:\Cherry Studio\work` while its parent installation directory remains. Registering user files under the installation directory exposes them to installer cleanup.

## Root cause

`electron-builder.yml:117–135` selects NSIS and permits a custom installation directory. `src/main/services/AppUpdaterService.ts:490–493` calls `autoUpdater.quitAndInstall(true, true)`. Upstream `app-builder-lib/templates/nsis/uninstaller.nsh:164–188` moves old installation files into `$PLUGINSDIR\old-install`, then unconditionally executes `RMDir /r $INSTDIR`; silent mode does not skip cleanup. `build/nsis-installer.nsh` provides no `customRemoveFiles` override. This removes files below `$INSTDIR` independently of application workspace cleanup.

## Decision

`src/main/ai/agents/agentWorkspaceInstallDirectory.ts` owns a pure policy using the existing `isSameOrInside` predicate. `AgentWorkspaceStorageService.registerWorkspace` rejects paths equal to or inside `application.getPath('app.install')` before reservation checks or database writes. The guard evaluates the same normalization the database persists (`normalizeWorkspacePathInput`, shared with `AgentWorkspaceService`), so trailing-separator and parent-traversal spellings cannot pass the guard and then be stored as the installation directory. Windows equivalent namespaces (`\\?\`, `\\.\`, `\\?\UNC\`) are folded inside the policy module, leaving the shared comparison helper unchanged. Packaged non-portable builds enforce the policy. Portable builds intentionally colocate data and have no in-app upgrades; unpackaged development is exempt. Missing or nonabsolute installation-directory facts allow registration.

The registration IPC handler maps `WorkspaceInstallDirectoryError` to `AI_AGENT_WORKSPACE_INSTALL_DIRECTORY` with both paths. The workspace selector and session creation show localized guidance to choose a directory outside the installation directory. Database-only services, existing workspace ID bindings, migration SQL, and the installer retain their responsibilities.

## Alternatives considered

- Preserve unknown subdirectories in NSIS cleanup: replacement would mix old and new installation files without a verifiable boundary.
- Automatically migrate workspaces at startup: moving user files and rebinding persisted paths requires a separate migration and recovery design.
- Warn without refusing registration: users could still register files that the next upgrade deletes.

## Consequences

Existing records are not automatically migrated; users receive the refusal when they next select that directory through registration. Existing session bindings continue using workspace IDs. Files already deleted by the installer cannot be recovered by this fix. Unknown installation facts fail open. Containment uses host-platform case folding and lexical comparison over the persisted normalization, with Windows namespace folding applied in the policy; filesystem identity and symlink/junction resolution remain outside this policy.

## Verification

- Regression — Targeted suites at the delivered head: 7 files, 354 tests pass. They cover Windows path semantics (equality, descendants, the similar sibling `Cherry Studio2`, case variants, ancestor directories, another drive), Windows namespace forms (`\\?\`, `\\.\`, `\\?\UNC\`), UNC and drive-root installation directories, trailing-separator and parent-traversal spellings of the installation directory, the portable/unpackaged/missing-fact exemptions, the IPC error mapping with both paths, the localized message with and without a directory, and registration ordering (no workspace row, no leaked reservation).
- Scoped main and error tests also run against real migrated SQLite and assert that a rejected registration writes no workspace row and leaves storage reservable, while an outside directory registers normally.
- Renderer consumers: WorkspaceSelector and Sessions pass; a refusal preserves the current selection and shows the recovery message. Shared actionable-error formatting covers session creation.
- Gates — `pnpm lint` (oxlint `--deny-warnings` plus ESLint), `pnpm typecheck`, all-locale i18n validation, and the repository documentation gate pass. No packaged Windows installer or interactive Electron upgrade is run.
