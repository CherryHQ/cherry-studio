# Naming Conventions

> Version: 1.0
> Last Updated: 2026-05
> **This document is the authoritative source. `CLAUDE.md` only links here.**

This document defines naming rules for files, directories, and identifiers across the Cherry Studio monorepo. It encodes both industry consensus (React/TypeScript, Node.js, shadcn/Next.js) and project-specific conventions that have stabilized over time.

---

## Table of Contents

1. [Quick Reference](#1-quick-reference)
2. [Core Principles](#2-core-principles)
3. [File Naming](#3-file-naming)
4. [Directory Naming](#4-directory-naming)
5. [Identifier Naming](#5-identifier-naming)
6. [Edge Cases](#6-edge-cases)
7. [Decision Tree](#7-decision-tree)
8. [Appendix: References](#appendix-references)

---

## 1. Quick Reference

The 90% case. See later sections for full rules and edge cases.

| What you're naming | Convention | Example |
|---|---|---|
| Business React component file | `PascalCase.tsx` | `Sidebar.tsx` |
| `packages/ui/` shadcn component file | `kebab-case.tsx` | `button.tsx`, `input-group.tsx` |
| Hook file | `useXxx.ts` (camelCase, `use` prefix) | `useChatContext.ts` |
| Util / function file (function-as-default-export) | `camelCase.ts` | `markdownConverter.ts` |
| Class-as-default-export file | `PascalCase.ts` (matches class name) | `KnowledgeService.ts`, `IpcChannel.ts` |
| Test file | `*.test.ts(x)` | `mcp.test.ts` |
| Config file | `*.config.ts` | `vitest.config.ts` |
| Type declaration | `*.d.ts` (lowercase / kebab) | `env.d.ts` |
| Top-level meta doc | `UPPERCASE.md` | `README.md`, `CLAUDE.md` |
| Regular doc | `kebab-case.md` | `database-testing.md` |
| npm package directory (`packages/*`) | `kebab-case` | `ai-sdk-provider/` |
| Business React component directory | `PascalCase` | `CodeEditor/` |
| Bucket directory (categorical container) | lowercase **plural** noun | `services/`, `utils/`, `hooks/` |
| Business / domain module directory | `camelCase` | `apiServer/`, `fileProcessing/` |
| `packages/ui/` directory | `kebab-case` | `primitives/`, `button-group/` |
| TanStack route file under `src/renderer/src/routes/` | `kebab-case.tsx` | `api-server.tsx`, `quick-assistant.tsx` |

---

## 2. Core Principles

Three rules trump any specific table below when in conflict:

1. **Consistency beats style choice.** A directory that consistently uses a "suboptimal" convention is healthier than one mixing two "correct" conventions.
2. **Cross-platform case safety.** Never rely on case to distinguish two files (e.g. `Foo.ts` and `foo.ts` in the same directory). macOS/Windows are case-insensitive by default; Linux is case-sensitive. Mixing breaks CI.
3. **Toolchain constraints win.** npm package names, shadcn CLI conventions, and Next.js routing rules are hard requirements — they override stylistic preference.

---

## 3. File Naming

### 3.1 React Component Files (`.tsx`)

| Location | Convention | Rationale |
|---|---|---|
| `src/renderer/src/components/**` | `PascalCase.tsx` | Filename mirrors the exported component name. |
| `src/renderer/src/pages/**` | `PascalCase.tsx` | Filename mirrors the exported component name. |
| `packages/ui/**` (shadcn-derived) | `kebab-case.tsx` | Required by shadcn CLI for cross-OS file resolution. |

The component's **exported identifier** is always `PascalCase`, regardless of filename style:

```tsx
// packages/ui/src/components/primitives/button.tsx
export function Button() { /* ... */ }

// src/renderer/src/components/Sidebar.tsx
export function Sidebar() { /* ... */ }
```

### 3.2 TypeScript Source Files (`.ts`)

Choose based on **what the file's default / primary export is**:

| Primary export | Convention | Example |
|---|---|---|
| Hook function (`useXxx`) | `camelCase.ts`, must start with `use` | `useShortcuts.ts` |
| Plain function or function group | `camelCase.ts` | `markdownConverter.ts`, `fileOperations.ts` |
| Class (especially services) | `PascalCase.ts` (matches class name) | `KnowledgeService.ts`, `IpcChannel.ts`, `IdleTimeoutController.ts` |
| Constants / enums only | `camelCase.ts` | `errorCodes.ts` |
| Re-export barrel | `index.ts` | — |

**Note:** Files under `packages/ui/` use `kebab-case.ts` regardless of export type (e.g. `use-dnd-reorder.ts`, `reorder-visible-subset.ts`), per §4.5 — that scope-specific rule overrides this section. The exported identifier (e.g. `useDndReorder`) remains `camelCase`.

### 3.3 Test Files

- **Suffix**: `*.test.ts` or `*.test.tsx`. Do **not** use `.spec.*`.
- **Location**: prefer co-location in `__tests__/` subdirectory next to source. Inline (`foo.ts` + `foo.test.ts` in same dir) is also acceptable.
- **Filename base**: match the file under test (`mcp.ts` → `mcp.test.ts`).

### 3.4 Config Files

- Pattern: `*.config.ts` (or `*.config.js` / `*.config.mjs` when TS is unsupported).
- Examples: `vitest.config.ts`, `electron.vite.config.ts`, `drizzle.config.ts`.

### 3.5 Type Declaration Files

- Pattern: `*.d.ts`, all-lowercase or `kebab-case`.
- Examples: `env.d.ts`, `global-types.d.ts`.

### 3.6 Markdown / Documentation

| Type | Convention | Example |
|---|---|---|
| Top-level meta docs at repo root | `UPPERCASE.md` | `README.md`, `CLAUDE.md`, `DESIGN.md`, `CONTRIBUTING.md` |
| Per-directory README | `README.md` (always uppercase) | `src/main/core/paths/README.md` |
| All other docs (under `docs/`, `packages/*/docs/`, etc.) | `kebab-case.md` | `database-testing.md`, `lan-transfer-protocol.md` |

### 3.7 JSON / YAML / TOML

- `package.json`, `tsconfig.json`: tool-mandated names; do not customize.
- Project-specific config JSON: `kebab-case.json` (`turbo.json` is an exception — tool-mandated).

---

## 4. Directory Naming

Directories fall into six distinct categories. Each has its own rule. §4.7 then layers singular-vs-plural choice on top of all of them.

### 4.1 npm Package Directories — `kebab-case`

`packages/*` directory names must be `kebab-case`. The directory name must equal the `name` field in `package.json` (minus the scope prefix).

```
packages/ai-sdk-provider/      ✅
packages/mcp-trace/            ✅
packages/extension-table-plus/ ✅
packages/somePkg/              ❌ (camelCase not allowed)
packages/SomePkg/              ❌ (PascalCase not allowed)
```

**Rationale**: npm package names allow only lowercase letters, digits, hyphens, and underscores. Directory ≠ package name causes confusion in imports and publishing.

### 4.2 Business React Component Directories — `PascalCase`

When a directory **is** a component (i.e. contains `index.tsx` exporting the component, or groups files under one component name), use `PascalCase`.

```
src/renderer/src/components/Sidebar/         ✅
src/renderer/src/components/CodeEditor/      ✅
src/renderer/src/components/MarkdownEditor/  ✅
```

### 4.3 Bucket Directories — `lowercase plural noun`

"Bucket" = a categorical container holding many unrelated items of the same kind.

```
services/   utils/   hooks/   components/   pages/   types/
```

Bucket names are **plural** (see §4.7 for singular-vs-plural rules across all directory kinds). Do **not** invent variants like `Services/` or `helpers-and-utils/`.

### 4.4 Business / Domain Module Directories — `camelCase`

When a directory represents a **named domain** (a coherent business module with its own internal structure), use `camelCase`.

```
src/main/ai/streamManager           ✅
src/main/services/fileProcessing/   ✅
```

### 4.5 shadcn / `packages/ui` Directories — `kebab-case`

Everything inside `packages/ui/` (both files and directories) follows shadcn conventions:

```
packages/ui/src/components/primitives/        ✅
packages/ui/src/components/primitives/button-group/  ✅
```

### 4.6 Convention-Mandated Directories

These have fixed names dictated by tools or community convention:

| Directory | Purpose |
|---|---|
| `__tests__/` | Test files (Jest/Vitest convention) |
| `__mocks__/` | Mock files (Jest/Vitest convention) |
| `node_modules/` | Dependencies (npm) |
| `dist/`, `build/`, `out/` | Build output |

### 4.7 Singular vs Plural

Choose number based on what the directory **conceptually contains**, not on which sounds nicer.

| Directory role | Number | Examples |
|---|---|---|
| **Collection bucket** — holds many items of the same kind | **plural** | `services/`, `utils/`, `hooks/`, `components/`, `pages/`, `types/`, `models/`, `shortcuts/`, `agents/` |
| **Namespace / theme** — represents one subject area, not a collection | **singular** | `config/`, `data/`, `auth/`, `api/`, `ipc/`, `file/` |
| **Business / domain module** — named action or concept | **singular** (default) | `apiServer/`, `fileProcessing/`, `webSearch/`, `bootConfig/` |
| **Component directory** (dir = component) | follows the **component name** | `Avatar/`, `CodeEditor/` (singular component); `SearchResults/`, `Buttons/` (component that represents a group) |

Decision rule: ask "does this directory hold **many of X**?" — yes → plural; no → singular. When two readings both make sense, pick the one that matches the directory's **default import name** (e.g. `import { ... } from './config'` reads naturally with `config/` singular).

---

## 5. Identifier Naming

Names inside source code — separate axis from filenames.

| Identifier kind | Convention | Example |
|---|---|---|
| Component, Class, Interface, Type alias, Enum type | `PascalCase` | `class KnowledgeService`, `interface UserConfig`, `type Status` |
| Variable, function, method, parameter | `camelCase` | `fetchUser`, `isReady` |
| Hook | `camelCase` with mandatory `use` prefix | `useChatContext` |
| Constant, enum member | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `IpcChannel.GetConfig` |
| Private class member | no `_` prefix; use `private` modifier | `private cache` |
| Generic type parameter | `PascalCase`, prefer descriptive | `<TItem>`, `<TError>` (avoid bare `T` for non-trivial cases) |

### 5.1 Singular vs Plural in Identifiers

| Identifier kind | Number | Example |
|---|---|---|
| Class, interface, type alias, enum type | **singular** | `User`, `OrderItem`, `LogLevel` (not `Users`, `OrderItems`) |
| Variable / property holding a single value | **singular** | `const user = ...`, `currentOrder` |
| Variable / property holding a collection (array, `Map`, `Set`) | **plural** | `const users = [...]`, `orderItems`, `connectedClients` |
| Boolean | no plural; use `is` / `has` / `can` / `should` prefix | `isReady`, `hasPermission`, `canEdit`, `shouldRetry` |
| Function returning one item | **singular** verb phrase | `getUser(id)`, `findOrder()` |
| Function returning many items | **plural** noun in name | `getUsers()`, `listOrders()`, `fetchPendingJobs()` |
| Function that mutates a collection | verb + plural object | `addUsers(...)`, `removeTags(...)` |
| Event / handler name | follows the event subject | `onMessageReceived` (one), `onItemsLoaded` (many) |

Pluralizing collection variables is the strongest signal of "this is iterable" — code that breaks this rule (`const user = fetchAllUsers()`) is consistently flagged in review, so the rule pays for itself.

---

## 6. Edge Cases

### 6.1 Acronyms and Initialisms

When an acronym (API, URL, ID, HTTP, MCP, AI) appears inside `PascalCase` or `camelCase`:

- **First letter uppercase, rest lowercase** — `HttpClient`, `UserId`, `ApiServer`, `McpService`.
- **Never all-caps** — `HTTPClient`, `UserID`, `APIServer` are forbidden.
- **At the start of `camelCase`** — entirely lowercase: `httpClient`, `userId`, `apiServer`.

### 6.2 Case-Only Renames

`git` on macOS defaults to `core.ignorecase=true`, which silently swallows pure case-change renames. Always use the two-step pattern:

```bash
git mv Foo.tsx _tmp_foo.tsx
git mv _tmp_foo.tsx foo.tsx
```

### 6.3 Two Files Differing Only in Case

Forbidden. `Button.tsx` and `button.tsx` in the same directory will break on case-insensitive file systems.

### 6.4 Barrel / Index Files

- Use `index.ts` or `index.tsx` (always lowercase).
- A barrel must re-export only — no business logic.
- Prefer **named exports** in barrels; avoid `export default` re-export chains.

### 6.5 Directory Name vs Package Name

In `packages/*`, the directory name and `package.json#name` (after stripping scope) must match exactly. Renaming one requires renaming the other.

### 6.6 TanStack Router File-Based Routes

Files under `src/renderer/src/routes/` are **kebab-case** — TanStack Router maps filename directly to URL (per §2.3).

Reserved tokens (TanStack-defined):

| Token | Meaning |
|---|---|
| `__root.tsx` | Root layout |
| `index.tsx` | Index route |
| `$<param>.tsx` | Dynamic segment (e.g. `$appId.tsx`) |
| `$.tsx` | Catch-all |

---

## 7. Decision Tree

```
Naming a new FILE
├─ React component (.tsx)?
│  ├─ Under src/renderer/src/routes/?  → kebab-case.tsx  (api-server.tsx)
│  ├─ Under packages/ui/?              → kebab-case.tsx  (button.tsx)
│  └─ Under src/renderer/src/?         → PascalCase.tsx  (Sidebar.tsx)
├─ React hook?                    → useXxx.ts       (useShortcuts.ts)
├─ Primary export is a class?     → PascalCase.ts   (KnowledgeService.ts)
├─ Primary export is function(s)? → camelCase.ts    (markdownConverter.ts)
├─ Type declaration?              → *.d.ts          (env.d.ts)
├─ Test?                          → *.test.ts(x)
├─ Config?                        → *.config.ts
└─ Documentation?
   ├─ Repo-root meta?             → UPPERCASE.md    (README.md)
   └─ Other?                      → kebab-case.md   (database-testing.md)

Naming a new DIRECTORY
├─ npm package (packages/*)?      → kebab-case      (ai-sdk-provider)
├─ Under packages/ui/?            → kebab-case      (primitives, button-group)
├─ Is itself a React component?   → PascalCase      (CodeEditor)
├─ Bucket / categorical container? → lowercase plural noun  (services, utils)
├─ Business domain module?        → camelCase       (apiServer, fileProcessing)
└─ Unsure singular vs plural?     → see §4.7
```

---

## Appendix: References

This document distills consensus from:

- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript) — file name matches default export
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [shadcn/ui conventions](https://github.com/shadcn-ui/ui) — kebab-case files, PascalCase exports
- [Next.js file-naming guidance](https://nextjs.org/docs)
- [typescript-eslint `naming-convention` rule](https://typescript-eslint.io/rules/naming-convention/)
