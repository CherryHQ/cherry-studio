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
})
