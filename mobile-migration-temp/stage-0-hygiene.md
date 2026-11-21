# Stage 0 — Repository Hygiene & Purity Guards

## Objective

Fix pre-existing violations of the workspace-package invariant, and install the import-purity lint
guards and shared-package conventions **before** any shared code lands. The guard must predate the
code it guards.

## Preconditions

None. Independent of all other stages. Zero changes under desktop `src/`.

---

## 0a. `packages/mcp-trace`: missing manifests

**Current state.** `packages/mcp-trace/trace-core/` and `packages/mcp-trace/trace-node/` are bare
source directories with no `package.json`. They are resolvable only through bundler aliases
(`electron.vite.config.ts:73-74` for the main process, `:120` for preload, `:167` for the
renderer), which violates the invariant *every child of `packages/` is a workspace package* and
makes them invisible to `pnpm --filter`, changesets, and dependency auditing.

**Procedure.**
1. Create `packages/mcp-trace/trace-core/package.json`:
   `{ "name": "@mcp-trace/trace-core", "private": true, "main": "<actual entry>.ts" }`.
   Repeat for `trace-node`.
2. `trace-node` is a Node-side implementation by design; it is **excluded** from the shared-purity
   guard allowlist (0d).
3. Bundler aliases remain untouched — desktop consumption is unchanged; desktop diff is zero.

## 0b. `packages/provider-catalog`: developer-local notice (no repository change)

**Current state.** The path is absent from git. Some developer worktrees contain only a gitignored
`.env` (≈40 provider API-key placeholders), with no manifest or sources.

There is nothing for a Stage 0 PR to remove. Do not automate deletion of this path because the
ignored file may contain developer-owned secrets. Developers may inspect their own worktree and
relocate or remove their local copy after confirming it has no consumer.

## 0c. `packages/ui`: undeclared dependencies + defective export condition

**Current state.** `@cherrystudio/ui@1.0.0-alpha.1` is a **published** package whose sources import
12 packages not declared in its manifest (they currently resolve only via pnpm root hoisting; an
external consumer gets `ERR_MODULE_NOT_FOUND` while CI stays green). Additionally, its
conditional export map repeats `"react-native": "./dist/…/index.js"` at the root and every JS
subpath (`.`, `./components`, `./hooks`, `./utils`, `./icons`, `./icons/providers`) — tsup scaffold
artifacts pointing the React Native condition at **web CJS builds**. If Metro ever resolved one of
these entries it would bundle DOM code paths into a native bundle.

**Procedure.**
1. Add to `packages/ui/package.json` `dependencies` (versions pinned to the root lockfile's
   currently-resolved versions):
   `@codemirror/lint`, `@codemirror/view`, `fast-diff`, `@hello-pangea/dnd`,
   `@tanstack/react-virtual`, `rehype-parse`, `rehype-stringify`, `react-error-boundary`,
   `@radix-ui/react-switch`.
2. Add to `devDependencies`: `@testing-library/react`, `@testing-library/user-event`,
   `@types/hast` (the `hast` import is type-only).
3. Delete the `"react-native"` condition from every entry in the `exports` map; checking only the
   root entry leaves subpath imports broken under Metro.
4. Audit every export entry in `packages/aiCore/package.json` and
   `packages/ai-sdk-provider/package.json` for the same scaffold artifact; delete any condition
   equally unbacked by a native build.

## 0d. Import-purity lint guard

**Design.** Purity is enforced per-package via an explicit allowlist, not a blanket
`packages/**` rule — the root `packages/` tree transitionally co-locates desktop-only packages
(`dsh-bridge`, `extension-table-plus`, `mcp-trace/trace-node`, `ui`) that legitimately import Node
or DOM APIs.

**Procedure.** In `eslint.config.mjs`, adjacent to the existing import-ban constants (≈L76,
`BAN_RENDERER_FROM_MAIN` et al.):

```
const SHARED_PURE_PACKAGES = [
  'packages/aiCore/src/**',
  'packages/ai-sdk-provider/src/**',
  'packages/provider-registry/src/**',   // EXCEPT the Node loader:
]
// ignores: ['packages/provider-registry/src/registry-loader/**']
//   (aliased as `@cherrystudio/provider-registry/node`; Node-side by contract)
```

Rule block: `@typescript-eslint/no-restricted-imports` with `patterns` banning
`electron`, `electron/*`, `expo-*`, `react-native`, `react-native-*`, `@react-native*`,
`node:*`, and bare Node builtins (`fs`, `path`, `os`, `crypto`, `child_process`, `stream`,
`http`, `https`, `net`, `zlib`, `util`, `buffer`).

**Growth protocol:** every shared package born in Stages 2–5 appends its glob to
`SHARED_PURE_PACKAGES` in the same PR that creates the package.

Additionally enable `import/no-extraneous-dependencies` over `packages/*/src/**`
(`eslint-plugin-import` is already a devDependency) to prevent recurrence of the 0c phantom-dependency
class.

## 0e. Shared-package conventions document

Create `docs/references/shared-packages.md`. Referenced normatively by all later stages. Contents:

1. **Package birth criteria** (all three required; otherwise code stays application-local):
   (a) name describes a content domain; (b) both applications consume it — evidenced by an existing
   mobile re-implementation, not by speculation; (c) coherent change cadence.
2. **Narrow-port injection (ports-and-adapters).** A shared package requiring I/O declares the
   minimal port interface *in its own module* (e.g. `readFile: (path: string) => Promise<Uint8Array>`);
   each application supplies the adapter at its composition root. No global `Platform` service, no
   service locator. A port is promoted to a standalone types package only when a **second**
   consumer package needs the identical capability.
3. **Shared-service lifecycle contract** (the intersection of both platforms' lifecycle semantics):
   - **No ordered-shutdown assumption.** Mobile processes are OS-killed without notice; `onStop`
     may never fire. Persistence must be write-through; flush-on-stop is forbidden.
   - **Host-replacement tolerance.** Mobile's `ApplicationHost` is rebuilt in place on Fast
     Refresh / test generations. No module-level mutable state; `start`/`stop` idempotent.
   - **No IPC surface.** Shared services expose plain methods; the desktop shell binds IpcApi
     endpoints externally.
   - **Foreground/background awareness via injected policy callbacks**, never by importing
     React Native `AppState`.
4. **Phase assignment at registration site.** Shared services do not carry `@ServicePhase`;
   each application assigns the phase where it registers the service (desktop `serviceRegistry.ts`,
   mobile composition root). Application-local services keep using the decorator.

## Verification

```
pnpm build:check && pnpm test && pnpm test:lint
cd packages/ui && pnpm build        # proves the package builds against its own declared deps
```

## PR Partitioning

| PR | Scope | Conventional commit |
|---|---|---|
| 1 | 0a | `chore(mcp-trace): add workspace manifests` |
| 2 | 0c | `fix(ui): declare phantom dependencies, drop bogus react-native export conditions` |
| 3 | 0d + 0e | `chore(lint): shared-package purity guard` + `docs(shared-packages): conventions` |
