Registry edits plus i18n. Blocked on the binaries existing.

## 1. Gate

- [ ] 1.1 Confirm `prometheus-002` has landed and `resources/binaries/` holds compass and rust-mcp-filesystem for this platform. sycophancy-correction waits on its release (`the-boss-release-infrastructure` §4) — add it last, or defer it to a follow-up rather than shipping a preset whose binary cannot exist.

## 2. Registry

- [ ] 2.1 Add the names to `BuiltinMcpServerNames` (`src/shared/utils/mcp.ts`) under `@prometheus/*`. It is a closed union; the type flows from it.
- [ ] 2.2 Add the presets to `PRESET_MCP_SERVERS`. Model the filesystem one on the existing `@cherry/filesystem` entry, including its manual-approval tool list.
- [ ] 2.3 Test first: every preset name is in the union; every stdio preset names a command and no `baseUrl`; compass declares no HTTP transport; the filesystem preset lists write tools in `disabledAutoApproveTools`; all ship `isActive: false`.

## 3. Seeder and i18n

- [ ] 3.1 Confirm `BuiltinMcpServerSeeder`'s `hashObject(PRESET_MCP_SERVERS)` version changes, and that an existing install picks up the new presets without disturbing user-owned fields (env, isActive, timeout).
- [ ] 3.2 Add a description string per server in all 13 locales; `pnpm i18n:sync` then `pnpm i18n:check`.

## 4. Verify

- [ ] 4.1 Targeted tests, then `pnpm lint`.
- [ ] 4.2 In the running app: each appears in the catalog, each can be enabled, and each connects when its backing binary or container is present. Paste the tool list each exposes.
- [ ] 4.3 With the binary absent, confirm the server reports unresolved and the app is unaffected.
- [ ] 4.4 **Windows:** confirm `.exe` resolution for all three stdio servers. Unverified until run.
