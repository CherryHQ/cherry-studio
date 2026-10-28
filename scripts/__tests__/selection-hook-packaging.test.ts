import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('selection-hook packaging', () => {
  // node-gyp-build resolves build/Release before prebuilds/, so the packaged tree must drop the
  // cross-compiled rebuild and keep the per-arch prebuilds — the reverse shipped an x86-64
  // .node inside the arm64 packages, where it can never load (#20530).
  it('ships the per-arch prebuilds instead of the cross-compiled rebuild', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      files?: string[]
    }

    const selectionHookPatterns = (config.files ?? []).filter((entry) => entry.includes('node_modules/selection-hook/'))

    expect(selectionHookPatterns).toContain('!node_modules/selection-hook/build/**')
    expect(selectionHookPatterns.some((entry) => entry.includes('/prebuilds/'))).toBe(false)
  })
})
