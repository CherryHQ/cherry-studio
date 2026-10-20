/**
 * Bundling contract for the `@ai-sdk/*` provider family.
 *
 * The main-process Rollup build externalizes every root `dependencies` entry
 * (electron.vite.config.ts `mainExternalDependencies`) and bundles everything else. Every
 * `@ai-sdk/*` package is pure JS that bundles cleanly, and each one depends on
 * `@ai-sdk/provider` + `@ai-sdk/provider-utils`, which are themselves `devDependencies` and
 * therefore pruned from a production package. So promoting any `@ai-sdk/*` package to
 * `dependencies` externalizes it and leaves its own imports unresolvable — the packaged app
 * crashes with MODULE_NOT_FOUND while dev and every test still pass, because the build only
 * externalizes what `dependencies` lists.
 *
 * `@ai-sdk/bytedance` was added as a `dependency` and hit exactly that; this is the guard the
 * electron.vite.config.ts comment notes was missing ("no test catches this").
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { isMainExternalModule } from '../../electron.vite.config'

const root = path.resolve(__dirname, '..', '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const aiSdkPackages = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].filter(
  (name) => name.startsWith('@ai-sdk/')
)

describe('@ai-sdk/* bundling contract', () => {
  it('declares the family so the guard below is not vacuously true', () => {
    expect(aiSdkPackages.length).toBeGreaterThan(10)
  })

  it('keeps every @ai-sdk/* package out of root dependencies, so the main build bundles it', () => {
    const externalized = Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith('@ai-sdk/'))
    expect(externalized).toEqual([])
  })

  it.each(aiSdkPackages)('bundles %s rather than externalizing it', (name) => {
    expect(isMainExternalModule(name)).toBe(false)
  })
})
