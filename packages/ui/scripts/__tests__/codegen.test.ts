import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateBarrelIndex, generateIconLoaders } from '../codegen'

describe('generateIconLoaders', () => {
  it('generates one dynamic import per icon without static component imports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const outPath = join(dir, 'loaders.ts')

    try {
      generateIconLoaders({
        outPath,
        entries: [
          { dirName: 'openai', colorName: 'Openai' },
          { dirName: '3min-top', colorName: 'MinTop3' }
        ],
        loadersName: 'PROVIDER_ICON_LOADERS',
        keyTypeName: 'ProviderIconKey'
      })

      const content = readFileSync(outPath, 'utf-8')
      expect(content).toContain("openai: () => import('./openai').then(({ OpenaiIcon }) => OpenaiIcon)")
      expect(content).toContain("'3min-top': () => import('./3min-top').then(({ MinTop3Icon }) => MinTop3Icon)")
      expect(content).not.toMatch(/import \{ OpenaiIcon \} from '\.\/openai'/)
      expect(content).not.toContain("from './catalog'")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('imports a named icon component without relying on index.tsx', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const barrelPath = join(dir, 'index.ts')
    const loadersPath = join(dir, 'loaders.ts')
    const entries = [
      {
        dirName: 'gpt-6-astra',
        colorName: 'Gpt6Astra',
        modulePath: './gpt-6-astra/gpt-6-astra'
      }
    ]

    try {
      generateBarrelIndex({ outPath: barrelPath, entries })
      generateIconLoaders({
        outPath: loadersPath,
        entries,
        loadersName: 'MODEL_ICON_LOADERS',
        keyTypeName: 'ModelIconKey'
      })

      expect(readFileSync(barrelPath, 'utf-8')).toContain(
        "export { Gpt6AstraIcon as Gpt6Astra } from './gpt-6-astra/gpt-6-astra'"
      )
      expect(readFileSync(loadersPath, 'utf-8')).toContain(
        "import('./gpt-6-astra/gpt-6-astra').then(({ Gpt6AstraIcon }) => Gpt6AstraIcon)"
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
