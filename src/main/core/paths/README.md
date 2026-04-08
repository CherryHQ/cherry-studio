# Paths Module

The single source of truth for every filesystem path used by the Electron
main process. Replaces ad-hoc `app.getPath()` / `os.homedir()` / `path.join`
constructions scattered throughout the codebase.

Every path the main process needs is registered once in `pathRegistry.ts`
(inside the `buildPathRegistry()` function) and accessed exclusively through
`application.getPath()`. The registry is **frozen at `Application.bootstrap()`
time** — calling `application.getPath(...)` before bootstrap throws.

## Quick Start

```ts
import { application } from '@main/core/application'

// Get a registered directory:
const filesDir = application.getPath('feature.files.data')
//=> '/Users/alice/Library/Application Support/CherryStudio/Data/Files'

// Get a file inside a registered directory:
const avatar = application.getPath('feature.files.data', 'avatar.png')
//=> '/Users/alice/Library/Application Support/CherryStudio/Data/Files/avatar.png'
```

`PathKey` is a string-literal union derived from `PATHS`, so invalid keys are
rejected at compile time:

```ts
application.getPath('invalid.key')
// TS2345: Argument of type '"invalid.key"' is not assignable to parameter
//         of type 'PathKey'.
```

## Module Layout

```
src/main/core/paths/
├── constants.ts          Earliest path constants (CHERRY_HOME, BOOT_CONFIG_PATH,
│                         LOGS_DIR). Consumed directly by LoggerService and
│                         BootConfigService — both run before the registry exists.
├── pathRegistry.ts       The `buildPathRegistry()` function (called once from
│                         Application.bootstrap()) plus the `PathKey` / `PathMap`
│                         types. Constrained by ESLint data-schema-key/valid-key.
├── index.ts              Public entry point. Re-exports `PathKey` and `PathMap`
│                         types only. `buildPathRegistry` is intentionally NOT
│                         re-exported — Application.ts imports it via the deeper
│                         alias `@main/core/paths/pathRegistry`.
└── README.md             This file.
```

The `paths/` module exports only **types** (`PathKey`, `PathMap`). The path
**values** are produced by `buildPathRegistry()` and held privately by
`Application.ts`. The lookup/validation logic lives on `Application.getPath`.
Consumers must go through `application.getPath(...)` rather than constructing
paths themselves.

## Top-Level Namespaces

There are five top-level namespaces. Each tells you something about
**ownership** and **lifecycle**:

| Namespace | Owns | Examples |
|-----------|------|----------|
| `cherry.*` | Generic infrastructure under `~/.cherrystudio` shared across multiple features | `cherry.home`, `cherry.bin`, `cherry.config` |
| `sys.*` | Operating-system directories returned by Electron's `app.getPath()` | `sys.home`, `sys.temp`, `sys.downloads` |
| `app.*` | The Electron application itself: install dir, resources, userData, database, logs, shared temp root | `app.exe_file`, `app.userdata`, `app.database.file`, `app.temp` |
| `feature.*` | Cherry-owned feature data, regardless of physical location | `feature.files.data`, `feature.mcp.oauth`, `feature.backup.temp` |
| `external.*` | Third-party tool paths Cherry integrates with (Cherry is reader/writer, NOT owner) | `external.openclaw.config` |

There is **no** standalone `temp.*` namespace. Each feature owns its own temp
directory at `feature.<name>.temp`. The shared physical root is `app.temp`.

The boundary between `feature.*` and `external.*` is **ownership**:

- `feature.*` — Cherry creates, manages, and may delete on uninstall.
- `external.*` — A third party owns the directory; Cherry only reads/writes.
  Cherry MUST NOT delete `external.*` directories on uninstall or reset.

### Default to `feature.*`

`feature.*` is the **open** scope — every new application-level key should
live here. The other four scopes describe **platform primitives** (OS
directories, Electron app structure, Cherry top-level infrastructure,
third-party tool paths) and are effectively **closed**; they rarely grow:

- `cherry.*` — generic infrastructure directly under `~/.cherrystudio`
- `sys.*` — directories the operating system owns
- `app.*` — fundamental Electron application paths (install, userData, logs,
  database, temp root)
- `external.*` — third-party tools Cherry integrates with

> ⚠ **Before adding a key under `cherry.*`, `sys.*`, or `app.*`, stop and
> double-check you're not mis-scoping.** Application functionality almost
> always belongs under `feature.*`.

Legitimate reasons to touch the closed scopes are rare. Examples:

- Exposing a new `app.getPath('xxx')` entry that a newer Electron version
  introduces
- Recording an OS-managed directory Electron doesn't abstract (e.g. the
  Linux `autostart` dir)
- Adding a brand-new top-level subdirectory under `~/.cherrystudio/` shared
  across many features (very rare)

If your reason isn't one of these, pick or invent a `feature.<name>`
grouping instead — that's almost certainly the right scope.

## Key Naming Convention

Path keys follow the same convention as preference keys, enforced at lint time
by `data-schema-key/valid-key`:

```
/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
```

- At least **2 segments** separated by `.`
- Each segment: lowercase letters, digits, and underscores
- Each segment must **start with a letter**
- Multi-word segments use `snake_case` (e.g. `crash_dumps`, `lan_transfer`)

### File vs Directory Naming

If a key refers to a **file** (not a directory), the key MUST clearly say so:

| Style | When to use | Example |
|-------|-------------|---------|
| `_file` suffix | Standalone file with no related sibling keys | `app.exe_file` → `/path/to/CherryStudio.exe` |
| `.file` last segment | File inside a namespace that has sibling members | `app.database.file` → `{userData}/cherrystudio.sqlite` (sibling: `app.database.migrations`) |

If the key refers to a **directory**, do NOT use `_file` or `.file` —
directories are the default.

### Auto-ensure and the `file` suffix rule

`Application.getPath()` automatically creates Cherry-owned directories on
first access (lazy auto-ensure with caching — see the next section). It uses
a single rule to decide whether a key refers to a file or a directory:

> **A key is treated as a file IFF it ends with `file`.**

This single rule covers all three file naming styles:

- `_file` suffix: `app.exe_file`
- `.file` last segment: `app.database.file`
- any `*file` suffix: `feature.foo.profilefile` (discouraged but valid)

**Critical constraint:** Directory keys **MUST NOT end with `file`**. Avoid:

- `feature.user.profile` ❌ (would be misclassified as a file → only the
  parent dir is ensured, never `profile/` itself)
- `feature.build.compile` ❌ (same)

If a directory's natural English name ends in `file`, append a
disambiguating segment: `feature.user.profile_dir` or
`feature.user.profiles`.

The `data-schema-key` ESLint rule enforces the registration format. The
`file` suffix collision is checked at PR review time (and may be enforced by
a custom lint rule in the future).

## Lazy Auto-ensure

`Application.getPath()` automatically creates Cherry-owned directories on
first access. Consumers receive a path that is **already on disk** and may
read or write through it without an explicit `fs.mkdirSync` step.

The behavior is:

- **Directory key** → `mkdirSync(base, { recursive: true })` on first
  access.
- **File key** (ends with `file`) → `mkdirSync(path.dirname(base), {
  recursive: true })`. The file itself is **not** created.
- Each `PathKey` is ensured **at most once per process**. Subsequent
  `getPath()` calls hit a cache and return immediately.
- If `mkdirSync` throws (read-only FS, missing permissions), the failure
  is logged via `loggerService.warn` and the path is returned anyway.
  The cache records the attempt regardless of outcome — `getPath` does
  not retry on every call (a perf trap on persistent failures).
- The opt-out list lives in `pathRegistry.ts` as a single `NO_ENSURE`
  array; see the next section for details.

### Maintaining the `NO_ENSURE` list

The unified `NO_ENSURE` array in `pathRegistry.ts` specifies which keys
opt out of auto-ensure. Entries come in two forms:

- **Namespace prefix** (ends with `.`): matches all keys under that
  namespace. Currently: `'sys.'` (OS-managed) and `'external.'`
  (third-party tools Cherry doesn't own).
- **Exact `PathKey`**: matches a single key. Currently used for build
  artifacts whose parent dirs are read-only in production
  (`app.exe_file`, `app.extra_resources`, `app.root.resources`,
  `app.database.migrations`, …).

**When to add a new entry:**

1. The key points to a **read-only location** in production (asar
   bundle, packaged resources, install directory, vendor binaries).
2. The key belongs to a **third-party app** Cherry doesn't own (use
   the `external.*` prefix when adding the key in the first place).
3. The key is an **OS-managed directory** Cherry shouldn't create
   (use the `sys.*` prefix; the `'sys.'` entry already covers it).

**When NOT to add:**

- The key is writable but a feature rarely uses it — **don't add**.
  Lazy auto-ensure means unused keys never trigger `mkdir`, so there's
  nothing to optimize.
- `mkdir` *might* fail due to permissions — **don't add**. The
  `try`/`catch` in `Application.getPath` handles that gracefully and
  the warning is the developer signal to investigate.

The `as const satisfies readonly NoEnsureEntry[]` clause guarantees
every entry is either a valid `PathKey` or a valid top-level namespace
prefix. Typos and stale references are caught at typecheck time, and
deleting a key from the registry forces an update here too.

### Known limitation: boot-time filesystem unavailability

Lazy auto-ensure caches each key after its first access, skipping
subsequent `mkdir` attempts. If the filesystem was temporarily
unavailable at first access (e.g. macOS volume not yet mounted at very
early boot), the cache will remember "tried to ensure" and won't retry
even after the FS becomes available. In practice this is extremely
rare because:

1. `Application.bootstrap()` runs after Electron `app.whenReady()`.
2. `getPath()` is first called by services in the lifecycle phases,
   well after bootstrap.
3. The underlying filesystems are mounted before Electron starts.

If this becomes an issue in the wild, manual recovery is possible via
a private helper — file a bug if you encounter it.

## The `.` Separator: Semantic, Not Always Physical

The `.` represents a **namespace / semantic group**. It usually — but not
always — corresponds to filesystem nesting.

| Type | Example |
|------|---------|
| **Aligned** (key matches filesystem) | `cherry.bin` → `~/.cherrystudio/bin` |
| **Aligned** | `app.userdata.data` → `{userData}/Data` |
| **Aligned** | `feature.ovms.ovms` → `~/.cherrystudio/ovms/ovms` |
| **Not aligned** | `feature.mcp.oauth` → `~/.cherrystudio/config/mcp/oauth` (semantically grouped under `feature.mcp.*` but lives under `config/`) |
| **Not aligned** | `feature.mcp.workspace` → `{userData}/Data/Workspace` (same `feature.mcp.*` namespace as `~/.cherrystudio/mcp` but completely different physical tree) |
| **Not aligned** | `feature.agents.skills.temp` → `{app.temp}/skill-install` (sibling `feature.agents.skills` lives at `{userData}/Data/Skills`) |
| **Not aligned** | `app.exe_file` → the .exe lives in `app.install`, not in any `app/exe/` dir |
| **Not aligned** | `app.logs` → `app.getPath('logs')` returns a platform-specific location (e.g. `~/Library/Logs/<App>/` on macOS) |

**Consumers MUST NOT** assume `a.b.c` is a filesystem sub-path of `a.b`. When
in doubt, consult the `PATHS` object directly.

## Adding a New Path Key

1. **Pick the right namespace** based on ownership (see the namespace table).
2. **Open `pathRegistry.ts`** and add the entry to the `PATHS` object literal
   in the appropriate section (each section is marked with a `// A.` / `// B.`
   header comment).
3. **Reuse a hoisted intermediate variable** if the path is a sub-directory of
   one already declared (e.g. `appUserDataData`, `appTemp`). Don't repeat
   `path.join` chains.
4. **Pick the right key shape**:
   - Directory? Just use the dotted key (no suffix).
   - Standalone file? Use `_file` suffix.
   - File inside a namespace with siblings? Use `.file` last segment.
5. **Run `pnpm lint`** — the ESLint rule will flag any naming-format violations.
6. **No tests required for the data itself** — the registry is data-only; the
   validation logic lives on `Application.getPath` and is already tested.

### Example: adding `feature.foo.config`

```ts
// In pathRegistry.ts, under the "// D. feature.* —" section:

  // -- Foo feature --
  'feature.foo.config': path.join(appUserDataData, 'Foo'),
```

## Using `getPath` in Services

Path lookup happens **only** via `Application.getPath`. Services access it via
the global `application` instance:

```ts
import { application } from '@main/core/application'

class MyService extends BaseService {
  async doSomething() {
    const dir = application.getPath('feature.files.data')
    const file = application.getPath('feature.files.data', 'config.json')
    // ...
  }
}
```

The `paths/` module deliberately does **not** export a standalone `getPath`
function. This forces every consumer through `Application.getPath`, which:

- Centralizes the filename validation in one place.
- Makes the access pattern uniform with `application.get('ServiceName')` for
  lifecycle services.
- Lets tests mock `application.getPath` once instead of mocking a function
  imported from many places.

## Composing Paths: When to Register, When to Join

A path key encodes the **largest static prefix** of a path — the part that's
the same for every call. How you compose anything beyond that depends on
whether the extra segment is static or dynamic, and (for dynamic ones)
whether it's a single filename or a deeper directory segment. Three cases,
three rules:

### 1. Static sub-paths → register a new key

If the extra segment is fixed at design time (e.g. `KnowledgeBase`, `Skills`,
`Channels`), **register it as its own key** in `pathRegistry.ts` rather than
joining it ad-hoc on the fly:

```ts
// ✅ pathRegistry.ts
'feature.knowledgebase.data': path.join(appUserDataData, 'KnowledgeBase'),

// ✅ caller
const dir = application.getPath('feature.knowledgebase.data')
```

```ts
// ❌ bypasses the registry, harder to grep, harder to test
const dir = path.join(application.getPath('app.userdata.data'), 'KnowledgeBase')
```

### 2. A single dynamic filename → use the `filename` argument

For a runtime filename (avatar, token file, per-record JSON) sitting directly
under a registered directory key, pass it as `getPath`'s **second argument**:

```ts
application.getPath('feature.files.data', 'avatar.png')                 // ✅
application.getPath('feature.agents.channels', `weixin_bot_${id}.json`) // ✅
```

The second argument is validated as a **single relative filename segment**.
If it's absolute, contains `..`, or contains a path separator,
`Application.getPath` **logs a warning via `loggerService` and still joins
the path** — the warning is a developer hint to either sanitize the input or
register a new key for the deeper path you're constructing:

```ts
application.getPath('feature.files.data', '/abs/path')   // ⚠️ warns
application.getPath('feature.files.data', '../escape')   // ⚠️ warns
application.getPath('feature.files.data', 'sub/file')    // ⚠️ warns
```

### 3. Dynamic directory segments → `path.join` over a static parent key

When the runtime segment is a **directory name** — per-agent, per-skill,
per-knowledge-base subdirectories where you may want to nest more paths
underneath, or where the segment isn't a plain leaf filename — registering a
key per value is impossible. Instead:

1. Register a key for the **largest static prefix**.
2. Use `path.join` at the call site to append the runtime segment.

```ts
// pathRegistry.ts — the static parent
'feature.agents.workspaces': path.join(appUserDataData, 'Agents'),

// BaseService.ts — the dynamic per-agent workspace
const workspaceDir = path.join(
  application.getPath('feature.agents.workspaces'),
  shortId
)
```

This `path.join`-over-a-key pattern is reserved for the few features that
genuinely need it (per-agent workspaces, per-skill storage folders). Most
consumers should still reach for plain `application.getPath(key)` or the
`(key, filename)` form first.

## Bootstrap Order

`buildPathRegistry()` reads `app.getPath('userData')` and other Electron
paths inside its function body. It is called exactly once, from
`Application.bootstrap()` at its entry point (after signal/quit handlers
are installed, before any lifecycle phase starts).

This means:

- `pathRegistry.ts` module evaluation has **no side effects** — importing
  the file is safe at any time.
- Any code that overrides Electron paths via `app.setPath(...)` MUST run
  **before** `application.bootstrap()` is invoked. The natural place is
  the top of `startApp()` in `src/main/index.ts`, eventually driven by
  `BootConfigService`.
- Calling `application.getPath(...)` before `bootstrap()` runs will throw
  with a clear error message. There is no fallback or lazy initialization.
- `LoggerService` and `BootConfigService` bypass this registry entirely:
  they need paths *before* the registry exists, so they read `LOGS_DIR`
  and `BOOT_CONFIG_PATH` directly from `paths/constants.ts`. This is by
  design, not a code smell — they form the bootstrap "zero layer" that
  the registry itself depends on.
- Runtime `app.setPath('userData', ...)` calls (e.g. via the legacy
  `App_SetAppDataPath` IPC handler) do **not** invalidate the frozen
  registry. The current v1 path-change flow always relaunches the app
  after such a call, so the divergence window never matters in practice;
  the IPC handler is marked TODO for v2 redesign.

## File-Level Constraint: No Other Object Literals in `pathRegistry.ts`

The ESLint rule `data-schema-key/valid-key` walks **every** `Property` AST
node in the file — including those inside function bodies. Defining a
helper object **anywhere in the file, including inside `buildPathRegistry()`'s
body**, would trip the rule. For example:

```ts
// ❌ DO NOT do this anywhere in pathRegistry.ts (top level OR inside the function):
const PLATFORM_OVERRIDES = {
  darwin: '...',
  win32: '...',
  linux: '...'
}
```

…would trip the rule on `darwin`, `win32`, and `linux` (none of which match
`namespace.sub.key_name`). Helper constants in `pathRegistry.ts` must be
`string` or `number` only. If you need a helper object, put it in a separate
file (e.g. a new `pathHelpers.ts`).

## Testing Patterns

`buildPathRegistry()` reads Electron `app.getPath()` at call time, so
naively calling it in tests can fail because the global Electron mock in
`tests/main.setup.ts` only stubs a subset of `app` methods.

There are two supported patterns depending on whether your test wants to
control the registry contents.

### Pattern 1 — Mock the registry, inject via test helper

If your test needs `application.getPath(...)` to return predictable values,
mock `@main/core/paths/pathRegistry` (NOT the public `@main/core/paths`
re-export) and inject the result via the `__setPathMapForTesting` helper:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/paths/pathRegistry', () => ({
  buildPathRegistry: () =>
    Object.freeze({
      'feature.files.data': '/mock/userData/Data/Files'
    })
}))

import { buildPathRegistry } from '@main/core/paths/pathRegistry'
import { Application } from '@main/core/application/Application'

describe('my service', () => {
  const app = Application.getInstance()
  app.__setPathMapForTesting(buildPathRegistry())

  it('uses the correct path', () => {
    expect(app.getPath('feature.files.data')).toBe('/mock/userData/Data/Files')
  })
})
```

Two things to note:

1. **Import `Application` from the file path**, not the directory. The global
   test setup mocks `@main/core/application` (the directory/index re-export);
   importing from `@main/core/application/Application` (the specific file)
   bypasses that mock and gives you the real class.
2. **Mock the deep path `@main/core/paths/pathRegistry`**, not the public
   `@main/core/paths` entry point. `Application.ts` imports `buildPathRegistry`
   via the deep path; mocking the public entry has no effect on
   `Application`'s view of the function.

### Pattern 2 — Bypass the throw without specific values

If your test doesn't care about specific path values but just needs `getPath`
to not throw (e.g. you're testing some other method that incidentally calls
it), you can pass an empty object cast to `PathMap`:

```ts
app.__setPathMapForTesting({} as PathMap) // values will be `undefined`
```

Prefer Pattern 1 in almost all cases.

### Compile-time enforcement

`PathKey` is a string-literal union derived from
`ReturnType<typeof buildPathRegistry>`, so invalid keys are rejected by
`tsgo` (`pnpm typecheck`). vitest's compile path uses esbuild and does NOT
enforce type-only directives like `@ts-expect-error` inside test cases —
rely on `pnpm typecheck` for type-level assertions.
