# Agent Note: CodeMate configuration and installation ownership

Status: implemented

English | [中文](2026-10-22-codemate-configuration-and-installation.zh.md)

## Problem

Advanced settings submitted an entire stale runtime snapshot, overwriting model and enablement changes from other entrances. Windows environment names were treated as case-sensitive during configuration writes, although the CLI reads them without case sensitivity. Binary upgrades replaced launchers but left old bundles unreachable by uninstall. Password-protected OpenCode WebUI instances failed readiness checks.

## Decision

Merge explicitly supplied `localRuntime` fields against the current Agent inside the existing SQLite write transaction. The update schema does not apply creation defaults. Omission preserves a field; explicit `undefined` clears an optional field. Advanced settings, enablement and model selection submit only fields they own. Other nested Agent configuration objects retain whole-value replacement semantics. No database migration is needed.

Use the effective environment for executable-name lookup. Windows environment lookup follows Node's lexicographic selection for duplicate names within a source; later explicit overrides replace the case-insensitive name. Native configuration writers use the same resolution.

Record binary bundles proved by the canonical launcher in an atomic installation manifest. Keep retired bundles during upgrade because manually launched CLI processes may still read sibling resources. Explicit uninstall reclaims recorded bundles only after containment, realpath and ownership checks. Never infer ownership from a directory-name prefix alone.

OpenCode readiness uses the configured Basic authentication. Browser authentication supplies credentials only for a running owned server's exact origin, a non-proxy Basic challenge and the existing WebView session. Credentials stay out of shared status and URLs; the handler belongs to the service lifecycle.

## Alternatives considered

- Refresh a renderer snapshot before saving: leaves a read/write race and requires callers to coordinate independently.
- Add a recursive merge for all configuration: changes unrelated object replacement contracts.
- Delete old binaries immediately after upgrade: can break external terminals still using their resources.
- Delete every directory with a matching prefix: lacks ownership evidence for unrelated user files.
- Treat unauthenticated HTTP 401 as ready: does not make the protected page usable.

## Consequences

Optional field clearing remains explicit, and callers must avoid resubmitting fields they do not edit. Binary installations without historical ownership records can retain unverifiable legacy orphan directories; these are intentionally left untouched. Windows filesystem and real installation behavior still require native-platform acceptance.

## Verification

- Regression — Production-migrated SQLite and schema tests cover partial updates, preserved model/enablement, explicit clearing and immutable protocol identity.
- Regression — Binary installation tests cover Windows command separators, path traversal rejection, retained upgrade resources and owned-history cleanup without following replaced symlinks.
- Regression — Environment and configuration tests cover mixed-case Windows directories and duplicate names; a real HTTP subprocess verifies protected WebUI readiness and authentication scope.
