import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateAvatar, generateIconIndex } from '../codegen'

describe('generateAvatar', () => {
  it('adds padding around neutral-background icons', () => {
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
      expect(content).toContain('style={{ width: size * 0.7, height: size * 0.7 }}')
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
      expect(content).not.toContain('size * 0.7')
      expect(content).not.toContain('size * 0.82')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(['Hunyuan', 'Kwaipilot', 'Spark'])('adds padding around the selected full-bleed %s icon', (colorName) => {
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
      expect(content).toContain(`<${colorName}Light style={{ width: size * 0.7, height: size * 0.7 }} />`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    'Ace',
    'Adobe',
    'Aihubmix',
    'Arcee',
    'Assemblyai',
    'Aya',
    'Bytedance',
    'Glmv',
    'Grok',
    'Kimi',
    'Jina',
    'Microsoft',
    'Nvidia',
    'Relace',
    'Sensenova',
    'Stepfun',
    'Udio',
    'Upstage',
    'Vertexai',
    'Voyage',
    'Xiaomimimo',
    'Yi'
  ])('scales the selected %s icon down further', (colorName) => {
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
      expect(content).toContain(`<${colorName}Light style={{ width: size * 0.6, height: size * 0.6 }} />`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders GPT neutral-background icons at the full avatar size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const outPath = join(dir, 'avatar.tsx')

    try {
      generateAvatar({
        outPath,
        colorName: 'Gpt4o',
        variant: 'neutral-background',
        hasDark: false
      })

      const content = readFileSync(outPath, 'utf-8')
      expect(content).toContain('<Gpt4oLight style={{ width: size, height: size }} />')
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
