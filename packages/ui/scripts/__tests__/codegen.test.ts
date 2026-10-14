import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateAvatar, generateBarrelIndex, generateIconIndex, generateIconLoaders } from '../codegen'

describe('generateAvatar', () => {
  it('renders neutral-background icons at the full avatar size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const outPath = join(dir, 'avatar.tsx')

    try {
      generateAvatar({
        outPath,
        colorName: 'Example',
        variant: 'neutral-background',
        hasDark: true
      })

      const content = readFileSync(outPath, 'utf-8')
      expect(content).toMatch(
        /import \{ Avatar, AvatarFallback \} from '@cherrystudio\/ui\/components\/primitives\/avatar';?\nimport \{ cn \} from '@cherrystudio\/ui\/lib\/utils';?\n\nimport \{ type IconAvatarProps \} from '\.\.\/\.\.\/types';?/
      )
      expect(content).toMatch(/<ExampleLight[\s\S]*?style=\{\{ width: size, height: size \}\}/)
      expect(content).not.toContain('size * 0.6')
      expect(content).not.toContain('size * 0.7')
      expect(content).not.toContain('size * 0.82')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders full-bleed icons at the full avatar size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const outPath = join(dir, 'avatar.tsx')

    try {
      generateAvatar({
        outPath,
        colorName: 'Example',
        variant: 'full-bleed',
        hasDark: false
      })

      const content = readFileSync(outPath, 'utf-8')
      expect(content).toContain('<ExampleLight style={{ width: size, height: size }} />')
      expect(content).not.toContain('size * 0.6')
      expect(content).not.toContain('size * 0.7')
      expect(content).not.toContain('size * 0.82')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(['Hunyuan', 'Kwaipilot', 'Spark'])('renders the selected full-bleed %s icon at full size', (colorName) => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const outPath = join(dir, 'avatar.tsx')

    try {
      generateAvatar({
        outPath,
        colorName,
        variant: 'full-bleed',
        hasDark: false
      })

      const content = readFileSync(outPath, 'utf-8')
      expect(content).toContain(`<${colorName}Light style={{ width: size, height: size }} />`)
      expect(content).not.toContain('size * 0.7')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generateIconIndex', () => {
  it('applies text-foreground to currentColor single-source logos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const outPath = join(dir, 'index.tsx')

    try {
      generateIconIndex({
        outPath,
        colorName: 'Bfl',
        hasAvatar: true,
        hasDark: false,
        usesCurrentColor: true,
        colorPrimary: '#000000'
      })

      const content = readFileSync(outPath, 'utf-8')
      expect(content).toContain("import { cn } from '../../../../lib/utils'")
      expect(content).toContain(
        "import type { CompoundIcon, CompoundIconProps } from '../../types'\n" +
          "import { BflAvatar } from './avatar'\n" +
          "import { BflLight } from './light'"
      )
      expect(content).toContain("className={cn('text-foreground', className)}")
      expect(content).not.toContain("from './dark'")
      expect(content).not.toContain('dark:hidden')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

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
      expect(content).toContain('satisfies Record<ProviderIconKey, () => Promise<CompoundIcon>>')
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
