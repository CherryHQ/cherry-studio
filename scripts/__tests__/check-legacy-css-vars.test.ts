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

  it('ignores variable definitions and comment-only mentions', () => {
    const content = `
      :root {
        --color-text-1: var(--color-foreground);
      }
      // var(--color-text-1)
      /* var(--color-text-2) */
    `

    expect(findLegacyVarHitsInContent(content, 'src/renderer/src/example.css')).toEqual([])
  })

  it('reports real legacy variable usages', () => {
    const content = `
      .title {
        color: var(--color-text-1);
      }

      const node = '<div class="text-[var(--color-text-2)]" />';
    `

    const findings = findLegacyVarHitsInContent(content, 'src/renderer/src/example.tsx')

    expect(findings).toHaveLength(2)
    expect(findings.map((finding) => finding.variable)).toEqual(['--color-text-1', '--color-text-2'])
    expect(findings.map((finding) => finding.line)).toEqual([3, 6])
  })

  it('uses the renderer source directory as the default target', () => {
    const files = collectTargetFiles()

    expect(files.length).toBeGreaterThan(0)
    expect(files.every((file) => file.includes(`${path.sep}src${path.sep}renderer${path.sep}src${path.sep}`))).toBe(
      true
    )
  })

  it('collects only the specified source file', () => {
    const tempDir = makeTempDir()
    const targetFile = path.join(tempDir, 'Component.tsx')
    const ignoredFile = path.join(tempDir, 'Component.test.tsx')

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

  it('auto-fixes mapped legacy variables in code lines only', () => {
    const content = [
      'const className = "text-(--color-text-2) bg-(--color-background-soft)"',
      'const linkStyle = { color: "var(--color-link)" }',
      '// var(--color-text-1)',
      ':root {',
      '  --color-text-1: var(--color-foreground);',
      '}'
    ].join('\n')

    const result = fixLegacyVarsInContent(content)

    expect(result.replacements).toBe(3)
    expect(result.content).toContain('text-(--color-foreground-secondary) bg-(--color-muted)')
    expect(result.content).toContain('var(--color-primary)')
    expect(result.content).toContain('// var(--color-text-1)')
    expect(result.content).toContain('--color-text-1: var(--color-foreground);')
  })

  it('writes auto-fixes for the specified path before strict validation', () => {
    const tempDir = makeTempDir()
    const targetFile = path.join(tempDir, 'style.css')
    const stdout = createCaptureStream()
    const stderr = createCaptureStream()

    fs.writeFileSync(targetFile, '.title { color: var(--color-text-1); }')

    const exitCode = runCli([targetFile, '--fix', '--strict'], { stdout: stdout.stream, stderr: stderr.stream })

    expect(exitCode).toBe(0)
    expect(fs.readFileSync(targetFile, 'utf8')).toBe('.title { color: var(--color-foreground); }')
    expect(stdout.output()).toContain('changed 1 files, replaced 1 usages')
    expect(stdout.output()).toContain('No legacy renderer CSS variable usages found.')
    expect(stderr.output()).toBe('')
  })
})
