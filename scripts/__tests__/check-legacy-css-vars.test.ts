import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

import {
  collectTargetFiles,
  findLegacyVarHitsInContent,
  fixLegacyVarsInContent,
  isCommentLine,
  runCli
} from '../check-legacy-css-vars'

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..')

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-css-vars-'))
}

function createCaptureStream(): { output: () => string; stream: Pick<typeof process.stdout, 'write'> } {
  let output = ''

  return {
    output: () => output,
    stream: {
      write: (chunk: string | Uint8Array): boolean => {
        output += chunk.toString()
        return true
      }
    }
  }
}

describe('check-legacy-css-vars', () => {
  it('identifies comment lines', () => {
    expect(isCommentLine('// var(--color-text-1)')).toBe(true)
    expect(isCommentLine('/* var(--color-text-1) */')).toBe(true)
    expect(isCommentLine('  * var(--color-text-1)')).toBe(true)
    expect(isCommentLine('color: var(--color-text-1);')).toBe(false)
  })

  it('reports deprecated definitions while ignoring comment-only mentions', () => {
    const content = `
      :root {
        --color-text-1: var(--color-foreground);
      }
      /* var(--color-text-1) */
      /* var(--color-text-2) */
    `

    const findings = findLegacyVarHitsInContent(content, 'src/renderer/example.css')

    expect(findings.map(({ variable, strategy, line }) => ({ variable, strategy, line }))).toEqual([
      { variable: '--color-text-1', strategy: 'exact', line: 3 }
    ])
  })

  it('reports real legacy variable usages', () => {
    const content = `
      const title = { color: 'var(--color-text-1)' }

      const node = '<div class="text-[var(--color-text-2)]" />';
    `

    const findings = findLegacyVarHitsInContent(content, 'src/renderer/example.tsx')

    expect(findings).toHaveLength(2)
    expect(findings.map((finding) => finding.variable)).toEqual(['--color-text-1', '--color-text-2'])
    expect(findings.map((finding) => finding.strategy)).toEqual(['exact', 'review'])
    expect(findings.map((finding) => finding.line)).toEqual([2, 4])
  })

  it('uses the repository as the default target while honoring migration exclusions', () => {
    const files = collectTargetFiles()

    expect(files.length).toBeGreaterThan(0)
    expect(files.some((file) => file.includes(`${path.sep}src${path.sep}renderer${path.sep}`))).toBe(true)
    expect(files.some((file) => file.includes(`${path.sep}packages${path.sep}ui${path.sep}`))).toBe(true)
    expect(files.some((file) => file.endsWith(`${path.sep}src${path.sep}styles${path.sep}theme.css`))).toBe(false)
  })

  it('collects specified consumer tests instead of hiding their contracts', () => {
    const tempDir = makeTempDir()
    const targetFile = path.join(tempDir, 'Component.test.tsx')
    const ignoredFile = path.join(tempDir, 'README.md')

    fs.writeFileSync(targetFile, 'color: var(--color-text-1);')
    fs.writeFileSync(ignoredFile, 'color: var(--color-text-2);')

    expect(collectTargetFiles(targetFile)).toEqual([targetFile])
    expect(collectTargetFiles(ignoredFile)).toEqual([])
  })

  it('collects matching files recursively from the specified directory', () => {
    const tempDir = makeTempDir()
    const nestedDir = path.join(tempDir, 'nested')
    const sourceFile = path.join(tempDir, 'style.css')
    const nestedSourceFile = path.join(nestedDir, 'Component.tsx')

    fs.mkdirSync(nestedDir)
    fs.writeFileSync(sourceFile, 'color: var(--color-text-1);')
    fs.writeFileSync(nestedSourceFile, 'color: var(--color-text-2);')
    fs.writeFileSync(path.join(tempDir, 'README.md'), 'var(--color-text-3)')

    expect(collectTargetFiles(tempDir).sort()).toEqual([sourceFile, nestedSourceFile].sort())
  })

  it('returns an error when the specified path does not exist', () => {
    const stdout = createCaptureStream()
    const stderr = createCaptureStream()

    const exitCode = runCli(['missing-legacy-css-vars-path'], { stdout: stdout.stream, stderr: stderr.stream })

    expect(exitCode).toBe(1)
    expect(stdout.output()).toBe('')
    expect(stderr.output()).toContain('Path does not exist: missing-legacy-css-vars-path')
  })

  it('returns a strict-mode error when the specified path contains legacy vars', () => {
    const tempDir = makeTempDir()
    const targetFile = path.join(tempDir, 'style.css')
    const stdout = createCaptureStream()
    const stderr = createCaptureStream()

    fs.writeFileSync(targetFile, 'color: var(--color-text-1);')

    const exitCode = runCli([targetFile, '--strict'], { stdout: stdout.stream, stderr: stderr.stream })

    expect(exitCode).toBe(1)
    expect(stdout.output()).toBe('')
    expect(stderr.output()).toContain(targetFile)
    expect(stderr.output()).toContain('--color-text-1')
  })

  it('honors LEGACY_CSS_VARS_STRICT for specified paths', () => {
    const tempDir = makeTempDir()
    const targetFile = path.join(tempDir, 'style.css')
    const stdout = createCaptureStream()
    const stderr = createCaptureStream()

    fs.writeFileSync(targetFile, 'color: var(--color-text-1);')

    const exitCode = runCli([targetFile], {
      env: { LEGACY_CSS_VARS_STRICT: 'true' },
      stdout: stdout.stream,
      stderr: stderr.stream
    })

    expect(exitCode).toBe(1)
    expect(stdout.output()).toBe('')
    expect(stderr.output()).toContain(targetFile)
  })

  it('auto-fixes exact variables in code strings and embedded CSS', () => {
    const content = [
      'const className = "text-(--color-text-2) bg-(--color-background-soft)"',
      'const linkStyle = { color: "var(--color-link)" }',
      'const iconStyle = { color: "var(--app-icon)" }',
      '// var(--color-text-1)',
      'const localTheme = `:root {',
      '  --color-text-1: var(--color-foreground);',
      '}`'
    ].join('\n')

    const result = fixLegacyVarsInContent(content)

    expect(result.replacements).toBe(2)
    expect(result.content).toContain('text-(--color-text-2) bg-(--color-background-soft)')
    expect(result.content).toContain('var(--cs-link)')
    expect(result.content).toContain('var(--app-icon)')
    expect(result.content).toContain('// var(--color-text-1)')
    expect(result.content).toContain('--foreground: var(--color-foreground);')
  })

  it('reports contextual rules without auto-fixing them', () => {
    const content = '.brand { color: var(--cs-primary); }'
    const findings = findLegacyVarHitsInContent(content, 'src/renderer/example.css')

    expect(findings.map(({ variable, strategy }) => ({ variable, strategy }))).toEqual([
      { variable: '--cs-primary', strategy: 'contextual' }
    ])
    expect(fixLegacyVarsInContent(content, 'src/renderer/example.css')).toEqual({ content, replacements: 0 })
  })

  it('excludes isolated local contracts that intentionally reuse generic names', () => {
    const localContractFiles = [
      path.join(REPOSITORY_ROOT, 'src/main/ai/mcp/servers/browser/tabbarHtml.ts'),
      path.join(REPOSITORY_ROOT, 'resources/devtools/main-network/panel.css')
    ]

    for (const filePath of localContractFiles) {
      expect(collectTargetFiles(filePath)).toEqual([])
    }
  })

  it('is idempotent after applying exact registry mappings', () => {
    const content = '.title { color: var(--color-text-1); }'
    const first = fixLegacyVarsInContent(content, 'src/renderer/example.css')
    const second = fixLegacyVarsInContent(first.content, 'src/renderer/example.css')

    expect(first).toEqual({ content: '.title { color: var(--foreground); }', replacements: 1 })
    expect(second).toEqual({ content: first.content, replacements: 0 })
  })

  it('writes auto-fixes for the specified path before strict validation', () => {
    const tempDir = makeTempDir()
    const targetFile = path.join(tempDir, 'style.css')
    const stdout = createCaptureStream()
    const stderr = createCaptureStream()

    fs.writeFileSync(targetFile, '.title { color: var(--color-text-1); }')

    const exitCode = runCli([targetFile, '--fix', '--strict'], { stdout: stdout.stream, stderr: stderr.stream })

    expect(exitCode).toBe(0)
    expect(fs.readFileSync(targetFile, 'utf8')).toBe('.title { color: var(--foreground); }')
    expect(stdout.output()).toContain('changed 1 files, replaced 1 usages')
    expect(stdout.output()).toContain('No deprecated CSS variable usages found.')
    expect(stderr.output()).toBe('')
  })
})
