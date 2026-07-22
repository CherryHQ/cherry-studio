import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateAvatar, generateIconIndex } from '../codegen'

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
