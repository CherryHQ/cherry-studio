import { EventEmitter } from 'node:events'
import type * as NodeFs from 'node:fs'

import type { FilePath } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.hoisted(() => vi.fn())
const mockPromisesStat = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: mockSpawn
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    existsSync: mockExistsSync,
    promises: {
      ...actual.promises,
      stat: mockPromisesStat
    }
  }
})

vi.mock('@main/utils/binaryResolver', () => ({
  getBinaryPath: async () => '/test/rg'
}))

vi.mock('@main/utils/binaryEnv', () => ({
  getBinaryExecutionEnv: () => ({})
}))

const { listDirectory } = await import('../search')

function createRipgrepChild(output: string, exitCode: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()

  setTimeout(() => {
    if (output) {
      child.stdout.emit('data', Buffer.from(output))
    }
    child.emit('close', exitCode, null)
  }, 0)

  return child
}

describe('listDirectory fuzzy fallback guard', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockPromisesStat.mockReset()
    mockSpawn.mockReset()
    mockExistsSync.mockReturnValue(true)
    mockPromisesStat.mockResolvedValue({ isDirectory: () => true })
  })

  it('does not score an unbounded greedy fallback candidate set', async () => {
    const fallbackOutput = Array.from({ length: 1001 }, (_, index) => `/workspace/release-candidate-${index}.ts`).join(
      '\n'
    )

    mockSpawn
      .mockImplementationOnce(() => createRipgrepChild('', 1))
      .mockImplementationOnce(() => createRipgrepChild(fallbackOutput, 0))

    await expect(
      listDirectory('/workspace' as FilePath, {
        searchPattern: 'release-c',
        maxEntries: 20
      })
    ).resolves.toEqual([])

    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })
})
