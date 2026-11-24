import fs from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findCommandInShellEnv } from '../commandResolver'

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
        const original = { statSync: fs.statSync, accessSync: fs.accessSync }
        const failure = createFailure()
        fs[operation] = () => {
          throw failure
        }
        let rejected = false

        try {
          await findCommandInShellEnv(executable, {})
        } catch (error) {
          rejected = true
          expect(Object.is(error, failure)).toBe(true)
        } finally {
          fs.statSync = original.statSync
          fs.accessSync = original.accessSync
        }

        expect(rejected).toBe(true)
      }
    )
  })
})
