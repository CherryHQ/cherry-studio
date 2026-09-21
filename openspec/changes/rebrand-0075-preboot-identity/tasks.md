# Tasks — rebrand-0075-preboot-identity

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## What changed

Hardcoded product literals that i18n could never reach, because they are OS-level
and third-party identity rather than UI strings. All now read from the branding
module:

| Surface | File | Why it matters |
|---|---|---|
| OAuth client name | `ai/mcp/oauth/provider.ts`, `services/tokenDanceOAuth.ts` | Shown on third-party **consent screens** |
| Linux window class | `core/preboot/chromiumFlags.ts` | Taskbar grouping and icon matching |
| Crash reporter | `core/preboot/crashTelemetry.ts` | Also `companyName: 'CherryHQ'` → `COMPANY_NAME` |
| Tracer name | `ai/observability/constants.ts`, `runtime/NodeTraceService.ts` | Emitted trace identity |
| MCP / skill client ID | `ai/mcp/McpRuntimeService.ts`, `ai/skills/skillRemoteSource.ts`, `ai/channels/ChannelMessageHandler.ts` | Sent to remote endpoints |
| Tray tooltip | `services/TrayService.ts` | Visible on hover |
| Relocation window title | `services/userDataRelocation/window.ts` | User-visible |
| Backup metadata | `services/LegacyBackupManager.ts` | See below |

## Backup compatibility — audited before changing

`LegacyBackupManager` both **writes** `appName` and **validates it on read**.
Renaming both sides naively would have made every existing backup unrestorable.
It now writes `PRODUCT_NAME` but accepts either name on read, via
`ACCEPTED_BACKUP_APP_NAMES`, so pre-rebrand backups still restore.

## Deliberately retained

Two literals stay, and both are backward-compatibility markers, not branding:

- `userDataLocation.ts` — `LEGACY_UPSTREAM_DIRNAME = 'CherryStudio'`, used to
  detect and report an unadopted upstream data directory (rebrand-003, D1).
- `LegacyBackupManager.ts` — `'Cherry Studio'` in the accepted-names list.

## Evidence

- `pnpm test:main` → 16383 passed, 0 failed
- `pnpm test:renderer` → 12138 passed
- `pnpm test:pkg:ui` → 792 passed
- `pnpm lint` → exit 0 (4 typecheck projects, 76011 translations)
- Tests repointed at the constants rather than re-pinned to new literals:
  `chromiumFlags`, `crashTelemetry`, `tokenDanceOAuth`, `LegacyBackupManager`,
  `OpenClawService`, `SkillService`
