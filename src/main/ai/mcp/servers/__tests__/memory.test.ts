import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({} as Record<string, unknown>)
})

const { application } = await import('@application')
const { default: MemoryServer } = await import('../memory')

async function listTools(server: InstanceType<typeof MemoryServer>) {
  const handlers = (server.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) throw new Error('No tools/list handler registered')
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('MemoryServer', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'memory-mcp-'))
    process.chdir(tempDir)
    vi.mocked(application.getPath).mockReturnValue(path.join(tempDir, 'default-memory.json'))
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('uses the application memory path when no custom path is configured', async () => {
    const result = await listTools(new MemoryServer())

    expect(result.tools.length).toBeGreaterThan(0)
    await expect(readFile(path.join(tempDir, 'default-memory.json'), 'utf8')).resolves.toContain('"entities": []')
  })

  it.each(['YOUR_MEMORY_FILE_PATH', '  YOUR_MEMORY_FILE_PATH  '])(
    'rejects the unresolved built-in placeholder before accessing the file system as %j',
    (configuredPath) => {
      expect(() => new MemoryServer(configuredPath)).toThrow(
        expect.objectContaining({
          code: 'MCP_UNRESOLVED_PLACEHOLDER',
          path: 'YOUR_MEMORY_FILE_PATH'
        })
      )
    }
  )
})
