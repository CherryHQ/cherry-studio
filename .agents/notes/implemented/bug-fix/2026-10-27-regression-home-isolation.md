# Agent Note: Isolate regression CLI configuration from the developer home

Status: implemented

English | [中文](2026-10-27-regression-home-isolation.zh.md)

## Problem

An isolated Electron `userData` directory does not isolate `sys.home` or the shared application temporary directory. Code Mate writes CLI configuration under the former, so a local regression run could replace the developer's Claude settings and Codex configuration and authentication. Cache cleanup and data reset can also remove shared temporary files. Restoring a profile or stopping Electron does not undo these changes.

## Decision

Both checkout and installer launches give each regression profile its own temporary home. The child environment overrides `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. `TEMP`, `TMP` and `TMPDIR` point to an existing directory inside that home. Windows also receives existing temporary `APPDATA` and `LOCALAPPDATA` directories so Electron can resolve application paths during startup. The controller's environment remains unchanged, and restarts retain the profile's temporary home.

Before every UI connection, the controller verifies process and inspector ownership and checks the running application's home, temporary and CLI configuration paths, plus Windows AppData. It refuses instances whose paths escape the profile, including instances launched before this repair.

## Alternatives considered

- Redirecting only `userData` leaves CLI configuration exposed.
- Saving and restoring personal configuration allows destructive writes before cleanup and cannot guarantee recovery after an interrupted run.
- Disabling CLI configuration writes would bypass the product behavior these scenarios exercise.

## Consequences

Tests start without personal CLI authentication or configuration. Tools installed under a personal home may need separate provisioning in the temporary test environment. Environment isolation covers the application's configured home paths; it is not an operating-system sandbox and does not restrict arbitrary absolute paths chosen by a scenario or tool. An external terminal that reuses another process's environment needs independent verification.

## Verification

- Regression — `scripts/e2e/regression/__tests__/launch.test.ts`: checkout and installer launches replace inherited home/configuration locations; Windows application-data directories exist, and the controller retains its original environment.
- Regression — `scripts/e2e/regression/__tests__/debugBridge.test.ts`: owned isolated instances connect; personal home, temporary, Windows AppData and CLI configuration paths are rejected.
- Regression — local Windows Electron inspection resolves `sys.home`, `appData`, `sys.temp`, `app.temp`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` inside the temporary profile; a code-tools phase leaves the monitored personal configuration files' SHA-256 hashes unchanged. This does not establish macOS runtime acceptance or recover files changed before isolation.
