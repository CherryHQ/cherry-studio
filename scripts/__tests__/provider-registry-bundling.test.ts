/**
 * Bundling contract for `@cherrystudio/provider-registry`.
 *
 * The package is INTERNAL and source-resolved (`private`, no published `dist`). The main-process Rollup
 * build externalizes every root `dependencies` entry (electron.vite.config.ts `mainExternalDependencies`),
 * so if this package were a `dependency` it would be externalized and resolve to
 * `node_modules/@cherrystudio/provider-registry/dist/*` — which is never built — and a packaged app would
 * crash at runtime with MODULE_NOT_FOUND. It must stay a `devDependency` (bundled from source via the
 * `@cherrystudio/provider-registry` alias). This is the build/pack smoke check guarding that contract.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..', '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const viteConfig = fs.readFileSync(path.join(root, 'electron.vite.config.ts'), 'utf8')

describe('@cherrystudio/provider-registry bundling contract', () => {
  it('is a devDependency (bundled from source), never an externalized root dependency', () => {
    expect(pkg.devDependencies?.['@cherrystudio/provider-registry']).toBeDefined()
    expect(pkg.dependencies?.['@cherrystudio/provider-registry']).toBeUndefined()
  })

  it('is source-aliased in electron.vite.config.ts so the main build bundles src, not dist', () => {
    expect(viteConfig).toMatch(/'@cherrystudio\/provider-registry':\s*resolve\('packages\/provider-registry\/src'\)/)
    expect(viteConfig).toMatch(
      /'@cherrystudio\/provider-registry\/node':\s*resolve\('packages\/provider-registry\/src\/registry-loader'\)/
    )
  })
})
