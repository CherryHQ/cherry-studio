import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashBuffer, hashFile } from '../checksum'

describe('checksum', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'checksum-test-'))
  })

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true })
  })

  describe('hashFile', () => {
    it('returns consistent SHA-256 hex for same content', async () => {
      const filePath = path.join(tempDir, 'test.txt')
      await fsp.writeFile(filePath, 'hello world')
      const hash1 = await hashFile(filePath)
      const hash2 = await hashFile(filePath)
      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64)
    })

    it('returns different hashes for different content', async () => {
      const file1 = path.join(tempDir, 'a.txt')
      const file2 = path.join(tempDir, 'b.txt')
      await fsp.writeFile(file1, 'hello')
      await fsp.writeFile(file2, 'world')
      const hash1 = await hashFile(file1)
      const hash2 = await hashFile(file2)
      expect(hash1).not.toBe(hash2)
    })

    it('handles empty files', async () => {
      const filePath = path.join(tempDir, 'empty.txt')
      await fsp.writeFile(filePath, '')
      const hash = await hashFile(filePath)
      expect(hash).toHaveLength(64)
    })

    it('rejects for non-existent files', async () => {
      await expect(hashFile(path.join(tempDir, 'nope.txt'))).rejects.toThrow()
    })
  })

  describe('hashBuffer', () => {
    it('returns SHA-256 hex', () => {
      const hash = hashBuffer(Buffer.from('hello world'))
      expect(hash).toHaveLength(64)
    })

    it('matches hashFile for same content', async () => {
      const content = 'test content for matching'
      const filePath = path.join(tempDir, 'match.txt')
      await fsp.writeFile(filePath, content)
      const fileHash = await hashFile(filePath)
      const bufferHash = hashBuffer(Buffer.from(content))
      expect(fileHash).toBe(bufferHash)
    })
  })
})
