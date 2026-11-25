import fs from 'fs'
import type * as Fs from 'fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findCommandInShellEnv } from '../commandResolver'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>()

  return {
    ...actual,
    default: { ...actual, statSync: vi.fn(actual.statSync), accessSync: vi.fn(actual.accessSync) }
  }
})

let root: string
let executable: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'command-resolver-'))
  executable = path.join(root, 'tool')
  await writeFile(executable, 'executable bytes', { mode: 0o700 })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('absolute executable lookup', () => {
  it('returns the existing absolute file without a shell query', async () => {
    await expect(findCommandInShellEnv(executable, {})).resolves.toBe(executable)
  })

  it('treats an absent target or a file parent as missing', async () => {
    await expect(findCommandInShellEnv(path.join(root, 'missing'), {})).resolves.toBeNull()
    await expect(findCommandInShellEnv(path.join(executable, 'child'), {})).resolves.toBeNull()
  })

  describe.each(['statSync', 'accessSync'] as const)('%s failures', (operation) => {
    it.each([
      ['permission error', () => Object.assign(new Error('permission denied'), { code: 'EACCES' })],
      ['null', () => null],
      ['undefined', () => undefined],
      [
        'unreadable code',
        () =>
          Object.defineProperty({}, 'code', {
            get() {
              throw new Error('unreadable code')
            }
          })
      ],
      [
        'revoked proxy',
        () => {
          const { proxy, revoke } = Proxy.revocable({}, {})
          revoke()
          return proxy
        }
      ]
    ] as const)(
      'preserves the original %s failure rather than claiming the executable is missing',
      async (_label, createFailure) => {
        const failure = createFailure()
        vi.mocked(fs[operation]).mockImplementationOnce(() => {
          throw failure
        })
        let rejected = false

        try {
          await findCommandInShellEnv(executable, {})
        } catch (error) {
          rejected = true
          expect(Object.is(error, failure)).toBe(true)
        } finally {
          vi.mocked(fs[operation]).mockReset()
        }

        expect(rejected).toBe(true)
      }
    )
  })
})
