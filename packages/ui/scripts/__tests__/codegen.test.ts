import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateIconIndex } from '../codegen'

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
      expect(content).toContain("className={cn('text-foreground', className)}")
      expect(content).not.toContain("from './dark'")
      expect(content).not.toContain('dark:hidden')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps visibility classes after className so a caller display utility cannot clobber them', () => {
    // Regression: with `cn('dark:hidden', className)`, a caller-supplied display
    // utility (e.g. `block`) wins via tailwind-merge and renders both icons.
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const outPath = join(dir, 'index.tsx')

    try {
      generateIconIndex({
        outPath,
        colorName: 'Kimi',
        hasAvatar: true,
        hasDark: true,
        usesCurrentColor: false,
        colorPrimary: '#000000'
      })

      const content = readFileSync(outPath, 'utf-8')
      expect(content).toContain("className={cn(className, 'dark:hidden')}")
      expect(content).toContain("className={cn(className, 'hidden dark:block')}")
      expect(content).not.toContain("cn('dark:hidden', className)")
      expect(content).not.toContain("cn('hidden dark:block', className)")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps text-foreground overridable while visibility classes stay fixed for mono dark logos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-codegen-'))
    const outPath = join(dir, 'index.tsx')

    try {
      generateIconIndex({
        outPath,
        colorName: 'Mimo',
        hasAvatar: true,
        hasDark: true,
        usesCurrentColor: true,
        colorPrimary: '#000000'
      })

      const content = readFileSync(outPath, 'utf-8')
      expect(content).toContain("className={cn('text-foreground', className, 'dark:hidden')}")
      expect(content).toContain("className={cn('text-foreground', className, 'hidden dark:block')}")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
