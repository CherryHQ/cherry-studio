import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isPathWithinRoots } from '../node'
import { canonicalizeTarget } from '../node'

let root = ''
let workspace = ''
let agentData = ''
let outside = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-permission-paths-'))
  workspace = join(root, 'workspace')
  agentData = join(root, 'agent-data')
  outside = join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(agentData)
  mkdirSync(outside)
  writeFileSync(join(workspace, 'inside.txt'), 'inside')
  writeFileSync(join(workspace, '@inside.txt'), 'at-inside')
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  symlinkSync(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

const roots = () => ({ workspace, agentData })

describe('isPathWithinRoots', () => {
  it('allows existing files in either trusted root', async () => {
    await expect(isPathWithinRoots(roots(), 'inside.txt')).resolves.toBe(true)
    await expect(isPathWithinRoots(roots(), join(agentData, 'missing.txt'), true)).resolves.toBe(true)
  })

  it('rejects outside paths and symlink escapes', async () => {
    await expect(isPathWithinRoots(roots(), '../outside/secret.txt')).resolves.toBe(false)
    await expect(isPathWithinRoots(roots(), 'escape/secret.txt')).resolves.toBe(false)
  })

  it('rejects ambiguous URLs and home shorthand', async () => {
    await expect(isPathWithinRoots(roots(), 'file:///etc/passwd')).resolves.toBe(false)
    await expect(isPathWithinRoots(roots(), '~/.ssh/config')).resolves.toBe(false)
  })

  it('folds unicode spaces without stripping literal @ path prefixes', async () => {
    await expect(isPathWithinRoots(roots(), 'inside\u00a0.txt')).resolves.toBe(false)
    await expect(isPathWithinRoots(roots(), '@inside.txt')).resolves.toBe(true)
  })

  it('fails closed when a trusted root cannot be canonicalized', async () => {
    await expect(isPathWithinRoots({ workspace: join(root, 'missing-root'), agentData }, 'inside.txt')).resolves.toBe(
      false
    )
  })
})

describe('canonicalizeTarget', () => {
  it('returns a canonical existing target and resolves missing descendants from the nearest parent', async () => {
    await expect(canonicalizeTarget(join(workspace, 'inside.txt'))).resolves.toBe(
      await realpath(join(workspace, 'inside.txt'))
    )
    await expect(canonicalizeTarget(join(workspace, 'new', 'file.txt'), true)).resolves.toBe(
      await realpath(workspace).then((canonicalWorkspace) => join(canonicalWorkspace, 'new', 'file.txt'))
    )
  })

  it('does not classify a missing target below an escaping symlink as safe', async () => {
    await expect(canonicalizeTarget(join(workspace, 'escape', 'new.txt'), true)).resolves.toBe(
      await realpath(outside).then((canonicalOutside) => join(canonicalOutside, 'new.txt'))
    )
  })
})
