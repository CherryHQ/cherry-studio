# Paths Module

Single source of truth for every filesystem path used by the main process.
All paths are registered in `pathRegistry.ts` and accessed exclusively via `application.getPath()`.

## Quick Start

```ts
import { application } from '@application'

const dir  = application.getPath('feature.files.data')
//=> '/Users/alice/Library/Application Support/CherryStudio/Data/Files'

const file = application.getPath('feature.files.data', 'avatar.png')
//=> '.../Data/Files/avatar.png'

application.getPath('invalid.key')
// TS2345: '"invalid.key"' is not assignable to type 'PathKey'
```

## Module Layout

| File | Role |
|------|------|
| `constants.ts` | Earliest path constants (`CHERRY_HOME`, `BOOT_CONFIG_PATH`, `LOGS_DIR`) — used before the registry exists |
| `pathRegistry.ts` | `buildPathRegistry()` + `PathKey` / `PathMap` types. ESLint-enforced key format |
| `index.ts` | Re-exports types only. `buildPathRegistry` is imported via deep alias by `Application.ts` |

## Top-Level Namespaces

| Namespace | Ownership | Examples |
|-----------|-----------|----------|
| `cherry.*` | Generic infra under `~/.cherrystudio` | `cherry.home`, `cherry.bin` |
| `sys.*` | OS-managed directories | `sys.home`, `sys.temp`, `sys.downloads` |
| `app.*` | Electron app: install dir, userData, database, logs, temp root | `app.userdata`, `app.database.file` |
| `feature.*` | Cherry-owned feature data (grouped by feature) | `feature.files.data`, `feature.mcp.oauth` |
| `external.*` | Third-party paths (Cherry reads/writes, does NOT own) | `external.openclaw.config` |

**Default to `feature.*` for new keys.** The other four scopes are effectively closed.
`feature.*` → Cherry creates/manages/may delete. `external.*` → Cherry MUST NOT delete.

## Key Naming Convention

Format: `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/` (enforced by ESLint `data-schema-key/valid-key`)

- At least 2 segments separated by `.`, each starts with a letter
- Multi-word segments: `snake_case` (e.g. `crash_dumps`, `lan_transfer`)

### File vs Directory

| Style | When | Example |
|-------|------|---------|
| `_file` suffix | Standalone file | `app.exe_file` |
| `.file` last segment | File with sibling keys | `app.database.file` (sibling: `app.database.migrations`) |
| No suffix | Directory (default) | `feature.files.data` |

**Critical:** Directory keys MUST NOT end with `file` — auto-ensure uses this to distinguish files from directories.

## Auto-ensure

`Application.getPath()` auto-creates directories on first access (cached, at most once per key):
- **Directory key** → `mkdirSync(base, { recursive: true })`
- **File key** (ends with `file`) → `mkdirSync(dirname(base))` (file itself is NOT created)
- Failures are logged as warnings; the path is still returned

### NO_ENSURE List

Keys in the `NO_ENSURE` array (in `pathRegistry.ts`) skip auto-ensure. Two entry forms:
- **Namespace prefix** (e.g. `'sys.'`, `'external.'`) — matches all keys under it
- **Exact PathKey** — for individual read-only paths (asar bundle, packaged resources, etc.)

Add a key to NO_ENSURE only if the target is **read-only in production** or **owned by a third party**.
Type-checked via `satisfies` — typos and stale references fail at compile time.

## The `.` Separator Is Semantic, Not Physical

`a.b.c` does NOT imply `a.b.c` is a sub-path of `a.b` on disk. Examples:

| Key | Physical location | Note |
|-----|-------------------|------|
| `feature.mcp.oauth` | `~/.cherrystudio/config/mcp/oauth` | Under `config/`, not `mcp/` |
| `feature.agents.skills.install.temp` | `{app.temp}/skill-install` | Sibling `feature.agents.skills` lives at `{userData}/Data/Skills` |

**Never assume filesystem nesting from key nesting.** Consult `pathRegistry.ts` directly.

## Composing Paths

### 1. Static sub-path → register a new key

```ts
// ✅ pathRegistry.ts
'feature.knowledgebase.data': path.join(appUserDataData, 'KnowledgeBase'),

// ❌ ad-hoc join bypasses the registry
path.join(application.getPath('app.userdata.data'), 'KnowledgeBase')
```

### 2. Single dynamic filename → use `getPath`'s second argument

```ts
application.getPath('feature.files.data', 'avatar.png')              // ✅
application.getPath('feature.files.data', '../escape')               // ⚠️ warns
```

The filename is validated — absolute paths, `..`, and separators trigger a warning.

### 3. Dynamic directory segment → `path.join` over a registered key

```ts
const workspace = path.join(
  application.getPath('feature.agents.workspaces'),
  shortId
)
```

Reserved for features that genuinely need per-instance subdirectories.

## Adding a New Path Key

1. Pick namespace (almost always `feature.*`)
2. Add entry in `pathRegistry.ts` under the appropriate section
3. Reuse hoisted vars (`appUserDataData`, `appTemp`, etc.)
4. Choose key shape: directory (no suffix), standalone file (`_file`), sibling file (`.file`)
5. If read-only, add to `NO_ENSURE`
6. Run `pnpm lint`

## File-Level Constraint in `pathRegistry.ts`

No object literals besides the registry itself — the ESLint rule validates every string-keyed property in the file. Helper constants must be primitives; put helper objects in a separate file.

## Bootstrap Order

`buildPathRegistry()` runs once during preboot (after `app.setPath('userData', ...)`, before `app.whenReady()`). Key implications:

- Every value must depend only on sync Electron APIs, `process.resourcesPath`, or Node built-ins
- Calling `application.getPath()` before `initPathRegistry()` throws
- `LoggerService` and `BootConfigService` bypass the registry — they read from `paths/constants.ts` directly (they run before the registry exists)

## Testing

Mock `@main/core/paths/pathRegistry` (the deep path, not the public re-export) and inject via `__setPathMapForTesting`:

```ts
vi.mock('@main/core/paths/pathRegistry', () => ({
  buildPathRegistry: () =>
    Object.freeze({ 'feature.files.data': '/mock/Data/Files' })
}))

import { buildPathRegistry } from '@main/core/paths/pathRegistry'
import { Application } from '@main/core/application/Application'

const app = Application.getInstance()
app.__setPathMapForTesting(buildPathRegistry())
```

Import `Application` from the file path (not the directory) to bypass the global test mock.
Use `pnpm typecheck` for type-level assertions — vitest's esbuild path doesn't enforce them.
