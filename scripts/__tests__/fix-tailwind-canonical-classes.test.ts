import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadTailwindDesignSystem, processPath, runCli } from '../fix-tailwind-canonical-classes'

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tailwind-canonical-'))
}

async function writeSource(tempDir: string, relativePath: string, source: string): Promise<string> {
  const filePath = path.join(tempDir, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, source)
  return filePath
}

describe('fix-tailwind-canonical-classes', () => {
  it('rewrites canonical Tailwind suggestions in JSX className strings', async () => {
    const tempDir = await createTempDir()
    const filePath = await writeSource(
      tempDir,
      'Component.tsx',
      `export function Component() {
  return (
    <div className="w-[420px] sm:max-w-[480px] min-h-[72px] !w-fit text-[var(--color-foreground-secondary)]" />
  )
}
`
    )

    const designSystem = await loadTailwindDesignSystem()
    const summary = await processPath(tempDir, designSystem)
    const source = await fs.readFile(filePath, 'utf8')

    expect(summary).toEqual({ scannedFiles: 1, changedFiles: 1, replacements: 5 })
    expect(source).toContain('className="w-105 sm:max-w-120 min-h-18 w-fit! text-(--color-foreground-secondary)"')
  })

  it('rewrites static cn string arguments and object keys', async () => {
    const tempDir = await createTempDir()
    const filePath = await writeSource(
      tempDir,
      'Component.tsx',
      `const value = cn('w-[420px]', { 'min-h-[72px]': enabled }, \`text-[var(--color-foreground-secondary)]\`)
`
    )

    const designSystem = await loadTailwindDesignSystem()
    const summary = await processPath(filePath, designSystem)
    const source = await fs.readFile(filePath, 'utf8')

    expect(summary).toEqual({ scannedFiles: 1, changedFiles: 1, replacements: 3 })
    expect(source).toBe("const value = cn('w-105', { 'min-h-18': enabled }, `text-(--color-foreground-secondary)`)\n")
  })

  it('leaves dynamic template literals unchanged', async () => {
    const tempDir = await createTempDir()
    const filePath = await writeSource(
      tempDir,
      'Component.tsx',
      `const value = cn(\`w-[420px] \${active ? 'min-h-[72px]' : ''}\`)
`
    )

    const designSystem = await loadTailwindDesignSystem()
    const summary = await processPath(filePath, designSystem)
    const source = await fs.readFile(filePath, 'utf8')

    expect(summary).toEqual({ scannedFiles: 1, changedFiles: 0, replacements: 0 })
    expect(source).toBe("const value = cn(`w-[420px] ${active ? 'min-h-[72px]' : ''}`)\n")
  })

  it('fails when the path argument is missing', async () => {
    let stderr = ''
    const exitCode = await runCli([], {
      stderr: {
        write: (chunk: string | Uint8Array) => {
          stderr += String(chunk)
          return true
        }
      },
      stdout: {
        write: () => true
      }
    })

    expect(exitCode).toBe(1)
    expect(stderr).toBe('Usage: pnpm styles:canonical <path>\n')
  })
})
