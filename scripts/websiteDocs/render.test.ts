import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { git } from './content.mjs'
import { assertIsolatedCheckout, runPnpm } from './render.mjs'

const cleanups: Array<() => void> = []
afterEach(() => {
  vi.unstubAllEnvs()
  while (cleanups.length) cleanups.pop()!()
})

function directory() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'cherry website renderer '))
  cleanups.push(() => rmSync(cwd, { recursive: true, force: true }))
  return cwd
}

describe('website renderer portability', () => {
  it('accepts its own Git root, including Windows Git slash normalization', () => {
    const cwd = directory()
    git(cwd, ['init', '--quiet'])
    expect(() => assertIsolatedCheckout(cwd)).not.toThrow()
  })

  it('rejects a directory that belongs to the enclosing repository', () => {
    const cwd = directory()
    git(cwd, ['init', '--quiet'])
    const nested = path.join(cwd, 'nested')
    // A missing .git inside the renderer must not authorize the enclosing checkout.
    mkdirSync(nested)
    expect(() => assertIsolatedCheckout(nested)).toThrow('Renderer directory is not an isolated checkout')
  })

  it.each([false, true])('launches pnpm without a shell (background: %s)', async (background) => {
    const cwd = directory()
    const entry = path.join(cwd, 'package manager.cjs')
    const output = path.join(cwd, 'received.json')
    writeFileSync(entry, "require('node:fs').writeFileSync('received.json', JSON.stringify(process.argv.slice(2)))")
    vi.stubEnv('npm_execpath', entry)
    const args = ['docs:generate', 'a b', 'literal&echo', '$(literal)', '`literal`']
    const child = runPnpm(args, { cwd, stdio: 'pipe', background })
    if (background) {
      await new Promise<void>((resolve, reject) => {
        child.on('error', reject)
        child.on('exit', (code: number) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))))
      })
    }
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(args)
  })

  it('explains how to run the renderer when pnpm did not provide its entry point', () => {
    vi.stubEnv('npm_execpath', '')
    expect(() => runPnpm(['docs:generate'])).toThrow('Run website documentation commands through pnpm')
  })
})
