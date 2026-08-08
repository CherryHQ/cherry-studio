import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { WindowType } from '../types'
import { WINDOW_TYPE_REGISTRY } from '../windowRegistry'

// On macOS, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` without
// `skipTransformProcessType: true` runs TransformProcessType(UIElement) inside Electron,
// deactivating the whole app (all windows drop behind the frontmost app) and removing
// the Dock icon. applyWindowBehavior executes the registry declaration on every window
// creation, so every entry opting into visibleOnFullScreen must skip the transform.
describe('WINDOW_TYPE_REGISTRY behavior invariants', () => {
  it('every visibleOnFullScreen declaration skips the macOS process transform', () => {
    for (const entry of Object.values(WINDOW_TYPE_REGISTRY)) {
      if (!entry) continue
      const declaration = entry.behavior?.visibleOnAllWorkspaces
      if (declaration?.visibleOnFullScreen) {
        expect(declaration.skipTransformProcessType, `WindowType '${entry.type}'`).toBe(true)
      }
    }
  })

  it('SelectionToolbar and QuickAssistant declare the flag (regression: enabling selection assistant hid the app)', () => {
    for (const type of [WindowType.SelectionToolbar, WindowType.QuickAssistant]) {
      expect(
        WINDOW_TYPE_REGISTRY[type]?.behavior?.visibleOnAllWorkspaces?.skipTransformProcessType,
        `WindowType '${type}'`
      ).toBe(true)
    }
  })
})

/**
 * a1 mutationCapable classification (backup-architecture.md §9 step 1).
 *
 * Every WindowType in the registry must declare `mutationCapable: boolean` so
 * `acquireMutationCapableWindowHold` knows which windows to destroy + block.
 * This suite enumerates ALL registered types and asserts the boolean is set
 * (no `undefined` / missing). A new WindowType added without a flag trips the
 * `getWindowTypeMetadata` fail-closed guard at first access — these tests
 * catch the regression at startup before the gate ever fires.
 */
describe('WINDOW_TYPE_REGISTRY mutationCapable classification (a1)', () => {
  it('every registered entry declares mutationCapable: true or false (no missing flag)', () => {
    for (const [type, entry] of Object.entries(WINDOW_TYPE_REGISTRY)) {
      if (!entry) continue
      expect(
        typeof entry.mutationCapable === 'boolean',
        `WindowType '${type}' is missing the required 'mutationCapable' flag (fail-closed a1 guard)`
      ).toBe(true)
    }
  })

  it('mutationCapable classifications match the documented empirical table', () => {
    // Hard-coded table from backup-architecture.md §9 step 1 — any drift here
    // means a renderer path changed (new writer / removed writer) and the
    // a1 hold scope must be revisited.
    const expected: Record<WindowType, boolean> = {
      [WindowType.Main]: true,
      [WindowType.SubWindow]: true,
      [WindowType.QuickAssistant]: true,
      [WindowType.SelectionAction]: true,
      [WindowType.SelectionToolbar]: false,
      [WindowType.Print]: false,
      [WindowType.McpBrowser]: false
    }
    for (const [type, value] of Object.entries(expected)) {
      const actual = WINDOW_TYPE_REGISTRY[type as WindowType]?.mutationCapable
      expect(actual, `WindowType '${type}'`).toBe(value)
    }
  })

  it('enum iteration: every registry entry is in the WindowType enum', () => {
    // Catches a future WindowType addition that lands in the registry
    // without being added to the enum (silent coverage gap).
    const enumValues = new Set<string>(Object.values(WindowType))
    const registeredValues = new Set<string>(
      Object.values(WINDOW_TYPE_REGISTRY)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
        .map((entry) => entry.type)
    )
    for (const registered of registeredValues) {
      expect(enumValues.has(registered), `Registry entry '${registered}' is not in WindowType enum`).toBe(true)
    }
  })
})

/**
 * Static-scan guard (a1 fail-closed at the renderer layer).
 *
 * For every NON-mutation-capable WindowType, walk the renderer source tree
 * and verify no file uses a DB-write API. This catches the regression
 * where a renderer file under a read-only surface (SelectionToolbar)
 * gains a write path while still being classified as
 * mutationCapable: false — that would silently bypass a1's renderer-kill
 * and reintroduce a writer into the snapshot→relaunch window.
 *
 * For mutation-capable types, writes are EXPECTED (they are why the type
 * is mutation-capable) — a1 destroys the renderer to gate them. This
 * suite therefore scans only the non-mutation-capable types; a positive
 * finding means the registry classification is wrong (or the renderer
 * grew a write path that should be on a mutation-capable type).
 *
 * Write API classification (matches the §9 "renderer-originated DB write"
 * definition):
 *   - `dataApi.request` calls — no renderer in Cherry Studio calls
 *     `dataApi.request('Foo.list', ...)` for reads; reads go through
 *     `useDataApi` / `useQuery`. Any `dataApi.request(` is a write.
 *   - `Preference_Set` / `Preference_SetMultiple` route names.
 *   - `usePreference(...)` destructure that BOTH reads AND writes:
 *     `const [value, setX] = usePreference(...)` or any two-binding
 *     form. Single-binding reads (`const [value] = usePreference(...)`)
 *     do not count — that's how SelectionToolbar reads
 *     `feature.selection.compact` and `feature.selection.action_items`
 *     without triggering this rule (see design §1).
 *
 * Heuristic, not a full AST analysis. Catches the common "I added a
 * setter to a non-mutation-capable surface" regression; the §9
 * promotion-fingerprint backstop is the correctness backstop for anything
 * the heuristic misses.
 */
describe('WINDOW_TYPE_REGISTRY mutationCapable static scan (a1)', () => {
  // Non-mutation-capable types' renderer source roots (relative to repo
  // root). The Main / SubWindow / QuickAssistant / SelectionAction trees
  // are deliberately NOT scanned here: their writes are expected and
  // gated by a1's renderer-kill. A regression in the classification
  // (e.g. a write path leaking into SelectionToolbar) trips this suite.
  const typeRoots: Partial<Record<WindowType, string>> = {
    [WindowType.SelectionToolbar]: 'src/renderer/windows/selection/toolbar'
    // Print is intentionally absent — its renderer (if any) is loaded
    // by PrintService with no preload and no API surface, so a write
    // path would have to bypass the IPC facade entirely. The registry
    // fail-closed guard on `mutationCapable` already gates new types.
  }

  // Repo root = cwd when vitest runs (vitest.config.* pins it to the project root).
  const repoRoot = process.cwd()

  // Best-effort file walker: stop at module boundaries, no symlink following.
  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return out
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full, out)
      else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) out.push(full)
    }
    return out
  }

  /**
   * Detect a write-style usePreference call: `const [a, b] = usePreference(...)`
   * (or any 2+ element destructure on the SAME line). Single-binding reads
   * (`const [value] = usePreference(...)`) do not count — that's how
   * SelectionToolbar reads `feature.selection.compact` and
   * `feature.selection.action_items` without triggering this rule. The
   * line-anchored regex avoids the false positive where two adjacent
   * single-binding reads span multiple lines and look like one tuple.
   */
  function isUsePreferenceWrite(content: string): boolean {
    // Multiline mode: `^` matches per-line, so a `const [a, b]` pattern
    // must be on the SAME line as the start of a `usePreference(...)`
    // call. A reader looks like `const [a]` (one binding); the regex
    // requires a comma between two bindings, so it won't match.
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!/const\s*\[\s*[^\]\n,]+\s*,\s*[^\]\n,]/.test(line)) continue
      // A `const [a, b]` on this line is a writer. Confirm a follow-up
      // line or the same line calls usePreference (the heuristic is
      // about usePreference writes specifically; two-binder destructure
      // outside that hook may be an array literal). Scan ahead a few
      // lines for `= usePreference(`.
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        if (/=\s*usePreference\s*\(/.test(lines[j])) return true
      }
    }
    return false
  }

  /** Detect an IpcApi write: any dataApi.request call. */
  function isDataApiWrite(content: string): boolean {
    return /\bdataApi\.request\s*\(/.test(content)
  }

  /** Detect an explicit Preference_Set route. */
  function isPreferenceSetRoute(content: string): boolean {
    return /['"]Preference_Set(Multiple)?['"]/.test(content)
  }

  it('non-mutation-capable types do not contain DB-write APIs in their renderer source', () => {
    for (const [type, root] of Object.entries(typeRoots)) {
      const fullRoot = join(repoRoot, root)
      if (!existsSync(fullRoot)) continue
      const files = walk(fullRoot)
      const offenders: { file: string; reason: string }[] = []
      for (const file of files) {
        const content = readFileSync(file, 'utf8')
        if (isPreferenceSetRoute(content)) {
          offenders.push({ file, reason: 'Preference_Set / Preference_SetMultiple' })
          continue
        }
        if (isDataApiWrite(content)) {
          offenders.push({ file, reason: 'dataApi.request (write)' })
          continue
        }
        if (isUsePreferenceWrite(content)) {
          offenders.push({ file, reason: 'usePreference two-binding destructure' })
        }
      }
      expect(
        offenders,
        `WindowType '${type}' (${root}) is non-mutation-capable but contains write APIs; offenders: ${JSON.stringify(offenders)}`
      ).toEqual([])
    }
  })
})
