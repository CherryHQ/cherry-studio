# Agent Note: Refuse Agent workspaces inside the installation directory

Status: implemented

English | [中文](2026-11-09-agent-workspace-install-directory.zh.md)

## Problem

Issue #23938 reports that a Windows in-app upgrade removes an Agent work directory such as `D:\Cherry Studio\work` while its parent installation directory remains. Registering user files under the installation directory exposes them to installer cleanup.

## Root cause

`electron-builder.yml:117–135` selects NSIS and permits a custom installation directory. `src/main/services/AppUpdaterService.ts:490–493` calls `autoUpdater.quitAndInstall(true, true)`. Upstream `app-builder-lib/templates/nsis/uninstaller.nsh:164–188` moves old installation files into `$PLUGINSDIR\old-install`, then unconditionally executes `RMDir /r $INSTDIR`; silent mode does not skip cleanup. `build/nsis-installer.nsh` provides no `customRemoveFiles` override. This removes files below `$INSTDIR` independently of application workspace cleanup.

## Decision

`src/main/ai/agents/agentWorkspaceInstallDirectory.ts` owns a pure policy using the existing `isSameOrInside` predicate. `AgentWorkspaceStorageService.registerWorkspace` rejects paths equal to or inside `application.getPath('app.install')` before reservation checks or database writes. Packaged non-portable builds enforce the policy. Portable builds intentionally colocate data and have no in-app upgrades; unpackaged development is exempt. Missing or nonabsolute installation-directory facts allow registration.

The registration IPC handler maps `WorkspaceInstallDirectoryError` to `AI_AGENT_WORKSPACE_INSTALL_DIRECTORY` with both paths. The workspace selector and session creation show localized guidance to choose a directory outside the installation directory. Database-only services, existing workspace ID bindings, migration SQL, and the installer retain their responsibilities.

## Alternatives considered

- Preserve unknown subdirectories in NSIS cleanup: replacement would mix old and new installation files without a verifiable boundary.
- Automatically migrate workspaces at startup: moving user files and rebinding persisted paths requires a separate migration and recovery design.
- Warn without refusing registration: users could still register files that the next upgrade deletes.

## Consequences

Existing records are not automatically migrated; users receive the refusal when they next select that directory through registration. Existing session bindings continue using workspace IDs. Files already deleted by the installer cannot be recovered by this fix. Unknown installation facts fail open. The shared predicate uses host-platform case folding and lexical containment; filesystem identity and symlink resolution remain outside this policy.

## Verification

- Regression — Policy and renderer errors: 2 files, 72 tests pass, covering Windows paths, equality, descendants, similar siblings, case variants, ancestors, other drives, development, portable builds, missing facts, localized guidance, and absent-path formatting.
- Scoped main and error tests: 5 files, 169 tests pass, including real migrated SQLite persistence, no workspace row after rejection, storage still reservable, outside registration, IPC error data, and unrelated failures.
- Renderer consumers: WorkspaceSelector and Sessions, 2 files, 157 tests pass; refusal preserves selection and displays the recovery message. Shared actionable-error formatting covers session creation.
- Changed-file ESLint, all-locale i18n validation, and the repository documentation gate pass. No packaged Windows installer or interactive Electron upgrade is run.
