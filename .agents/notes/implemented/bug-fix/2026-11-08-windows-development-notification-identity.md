# Agent Note: Bound Windows development notification identities

Status: implemented

English | [中文](2026-11-08-windows-development-notification-identity.zh.md)

## Problem

The toolkit's application-ID helper substitutes `process.execPath` in development. A Windows regression checkout produced a 139-character identity. [Windows limits AppUserModelIDs to 128 characters and excludes spaces](https://learn.microsoft.com/en-us/windows/win32/shell/appids), so executable paths are not a reliable application identity.

The notification API reported a successful show and retained the reply in history, while the system panel did not display it. A separate test prerequisite also mattered: an isolated `APPDATA` requires explicit shell registration, covered by the [native controller note](../testing/2026-11-07-native-controller-state-observation.md).

## Decision

Call Electron's Windows API directly before lifecycle bootstrap. Packaged builds use the existing edition ID; development builds append `.Development` to that ID. Both edition IDs remain bounded and independent of checkout paths, and development stays distinct from the installed application.

## Alternatives considered

- Shortening the CI checkout path hides the failure for longer or space-containing developer paths.
- Truncating an executable path can collide with another installation and still leaves invalid characters.
- Using the production identity for development combines their Windows identity unnecessarily.

## Consequences

Development taskbar grouping and notifications use the edition's development identity. Packaged identity remains aligned with its installer. macOS and Linux do not call the Windows API.

## Verification

- Regression — eight application-edition consumer tests passed, including alignment with both packaging configurations; Node types and scoped lint passed.
- Regression — Windows MP-110 passed real system delivery, native activation back to the completed topic, persisted settings and disabled-category suppression with the required shell fixture. Native adapter validation and owned-shortcut cleanup audit also passed. This focused proof does not replace full dual-platform regression.
