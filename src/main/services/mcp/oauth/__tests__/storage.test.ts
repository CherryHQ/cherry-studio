import fs from 'node:fs/promises'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { JsonFileStorage } from '../storage'

describe('JsonFileStorage', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true })
      })
    )
  })

  const createTempDir = async () => {
    const baseDir = path.join(process.cwd(), '.context', 'vitest-temp')
    await fs.mkdir(baseDir, { recursive: true })
    const dir = await fs.mkdtemp(path.join(baseDir, 'mcp-oauth-storage-'))
    tempDirs.push(dir)
    return dir
  }

  it('recovers from malformed JSON by backing it up and recreating an empty storage file', async () => {
    const dir = await createTempDir()
    const filePath = path.join(dir, 'server_oauth.json')
    await fs.writeFile(filePath, '{')

    const storage = new JsonFileStorage('server', dir)

    await expect(storage.getClientInformation()).resolves.toBeUndefined()

    const recreated = JSON.parse(await fs.readFile(filePath, 'utf8')) as { lastUpdated: number }
    expect(recreated.lastUpdated).toEqual(expect.any(Number))

    const files = await fs.readdir(dir)
    const backupFile = files.find((file) => file.startsWith('server_oauth.json.corrupt-'))
    expect(backupFile).toBeDefined()
    await expect(fs.readFile(path.join(dir, backupFile!), 'utf8')).resolves.toBe('{')
  })

  it('recovers from schema-invalid data and allows future writes to succeed', async () => {
    const dir = await createTempDir()
    const filePath = path.join(dir, 'server_oauth.json')
    await fs.writeFile(filePath, JSON.stringify({ lastUpdated: 'broken' }))

    const storage = new JsonFileStorage('server', dir)

    await expect(storage.saveCodeVerifier('verifier-123')).resolves.toBeUndefined()

    const stored = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      codeVerifier: string
      lastUpdated: number
    }
    expect(stored.codeVerifier).toBe('verifier-123')
    expect(stored.lastUpdated).toEqual(expect.any(Number))
  })
})
