import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { agentRootPath, ensureAgentRoot, importIdentityAndMemory, MEMORY_DIRNAME } from '../agentRoot'

describe('agentRoot', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'agent-root-test-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  describe('agentRootPath', () => {
    it('joins the roots base dir with the agent id', () => {
      expect(agentRootPath('/data/Agents/Roots', 'agent-1')).toBe(path.join('/data/Agents/Roots', 'agent-1'))
    })
  })

  describe('ensureAgentRoot', () => {
    it('creates the root and its memory subdirectory', async () => {
      const root = path.join(base, 'root')
      await ensureAgentRoot(root)
      expect(existsSync(root)).toBe(true)
      expect(existsSync(path.join(root, MEMORY_DIRNAME))).toBe(true)
    })
  })

  describe('importIdentityAndMemory', () => {
    it('copies identity files and the memory dir into the root', async () => {
      const src = path.join(base, 'src')
      mkdirSync(path.join(src, MEMORY_DIRNAME), { recursive: true })
      writeFileSync(path.join(src, 'SOUL.md'), 'soul content')
      writeFileSync(path.join(src, 'USER.md'), 'user content')
      writeFileSync(path.join(src, MEMORY_DIRNAME, 'FACT.md'), 'fact content')

      const root = path.join(base, 'root')
      const copied = await importIdentityAndMemory(src, root)

      expect(copied).toContain('SOUL.md')
      expect(copied).toContain('USER.md')
      expect(copied).toContain(MEMORY_DIRNAME)
      expect(readFileSync(path.join(root, 'SOUL.md'), 'utf-8')).toBe('soul content')
      expect(readFileSync(path.join(root, MEMORY_DIRNAME, 'FACT.md'), 'utf-8')).toBe('fact content')
    })

    it('is idempotent and never overwrites existing destination files', async () => {
      const src = path.join(base, 'src')
      mkdirSync(src, { recursive: true })
      writeFileSync(path.join(src, 'SOUL.md'), 'new content')

      const root = path.join(base, 'root')
      await ensureAgentRoot(root)
      writeFileSync(path.join(root, 'SOUL.md'), 'existing content')

      const copied = await importIdentityAndMemory(src, root)

      expect(copied).not.toContain('SOUL.md')
      expect(readFileSync(path.join(root, 'SOUL.md'), 'utf-8')).toBe('existing content')
    })

    it('matches identity files case-insensitively', async () => {
      const src = path.join(base, 'src')
      mkdirSync(src, { recursive: true })
      writeFileSync(path.join(src, 'soul.md'), 'lower soul')

      const root = path.join(base, 'root')
      const copied = await importIdentityAndMemory(src, root)

      expect(copied).toContain('SOUL.md')
      expect(readFileSync(path.join(root, 'SOUL.md'), 'utf-8')).toBe('lower soul')
    })

    it('is a no-op when the source has no identity or memory', async () => {
      const src = path.join(base, 'empty-src')
      mkdirSync(src, { recursive: true })
      const root = path.join(base, 'root')

      const copied = await importIdentityAndMemory(src, root)

      expect(copied).toEqual([])
    })
  })
})
