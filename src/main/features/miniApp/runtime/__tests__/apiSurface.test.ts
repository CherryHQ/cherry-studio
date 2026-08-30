import fs from 'node:fs'
import path from 'node:path'

import { MINI_APP_METHODS } from '@shared/types/miniAppManifest'
import { describe, expect, it } from 'vitest'

const DTS = fs.readFileSync(path.join(process.cwd(), 'docs/references/mini-app/cherry.d.ts'), 'utf8')
const PRELOAD = fs.readFileSync(path.join(process.cwd(), 'src/preload/miniAppBridge.ts'), 'utf8')

/** The real namespaces, derived so `CherryApi` / `CherryUsage` are never mistaken for one. */
const NAMESPACES = new Set(Object.keys(MINI_APP_METHODS).map((m) => m.split('.')[0]))

/** `namespace.method` pairs the declaration file actually exposes. */
function declaredMethods(source: string): string[] {
  const out: string[] = []
  // Brace-COUNTED, not `[^}]*`: `chat(): Promise<{ ok: true }>` closes a brace inside its
  // own signature, and a non-greedy body match would end the interface right there.
  for (const m of source.matchAll(/interface Cherry([A-Z]\w*)\s*\{/g)) {
    const prefix = m[1][0].toLowerCase() + m[1].slice(1)
    if (!NAMESPACES.has(prefix)) continue
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') depth--
    }
    for (const [, name] of source.slice(start, i - 1).matchAll(/^\s*(\w+)\s*\(/gm)) out.push(`${prefix}.${name}`)
  }
  return out.sort()
}

describe('cherry.d.ts is the same surface the bridge routes', () => {
  it('declares exactly the routed methods', () => {
    // The bug this catches: a method that is callable, gated and quota-ed but missing
    // from the shipped types — or the reverse, a type promising a method that 404s.
    expect(declaredMethods(DTS)).toEqual(Object.keys(MINI_APP_METHODS).sort())
  })

  it('parses past a nested brace in a return type', () => {
    // The control "more than zero" could not be: `ai.chat` returns `Promise<{ ok: true }>`, so a
    // parser stopping at the first `}` still returns a non-empty — merely truncated — list.
    expect(declaredMethods(DTS)).toContain('ai.cancel')
  })

  it('the preload never hands the guest a bare Error', () => {
    /*
     * The other half of the error contract, and the one a main-side test cannot see.
     * `ipcMain.handle` erases `name` from a rejection (`electron.d.ts:8877`), which is why
     * main returns an envelope — but a `new Error(...)` thrown INSIDE preload reaches the
     * guest with `name === 'Error'` and lands outside the frozen seven just the same.
     */
    expect(PRELOAD).not.toMatch(/throw new Error\(/)
    expect(PRELOAD).toMatch(/const cherryError = /)
  })

  it('the guest bridge actually exposes every routed method', () => {
    /*
     * The hole the two cases above cannot see. They compare a TYPE FILE with a TABLE OF
     * NAMES — both of which a developer edits in one sitting — while the thing an author
     * actually calls is the preload object. `app.getPermissions` and `network.fetch` were
     * declared, gated, quota-ed and documented while no preload function called either.
     */
    const called = [...PRELOAD.matchAll(/call(?:Streaming)?\('([\w.]+)'/g)].map((m) => m[1])
    expect([...new Set(called)].sort()).toEqual(Object.keys(MINI_APP_METHODS).sort())
  })

  it('declares the frozen error names and nothing else', () => {
    // The error set is frozen (design 6.0) — an eighth name would reach an author's
    // `catch (e)` unhandled. Capture spans lines: `\s*` after `=` eats the newline too.
    const union = DTS.match(/type CherryErrorName\s*=((?:\s*\|?\s*'[^']+')+)/)?.[1] ?? ''
    expect(union.match(/'[^']+'/g)?.sort()).toEqual(
      [
        "'Cancelled'",
        "'Internal'",
        "'InvalidArgument'",
        "'PermissionDenied'",
        "'QuotaExceeded'",
        "'RateLimited'",
        "'Unavailable'"
      ].sort()
    )
  })
})
