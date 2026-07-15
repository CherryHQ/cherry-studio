import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..', '..')
const viteConfig = fs.readFileSync(path.join(root, 'electron.vite.config.ts'), 'utf8')

describe('main-process bundling contract', () => {
  it('preserves dynamic imports as lazy chunks', () => {
    expect(viteConfig).not.toMatch(/inlineDynamicImports:\s*true/)
    expect(viteConfig).not.toMatch(/manualChunks:\s*undefined/)
  })

  it('keeps lazy chunks from importing and re-executing the main entry', () => {
    expect(viteConfig).toMatch(/preserveEntrySignatures:\s*'strict'/)
    expect(viteConfig).toContain("name: 'main-entry-isolation'")
  })
})
