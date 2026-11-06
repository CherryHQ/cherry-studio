import { describe, expect, it } from 'vitest'

import { launchSizeErrno, summarizeLaunchInput } from '../claudeCodeLaunchSize'

describe('launch size diagnostics', () => {
  it.each<[unknown, string | undefined]>([
    [{ code: 'EPERM', message: 'spawn ENAMETOOLONG' }, undefined],
    [{ code: 'E2BIG', message: 'other' }, 'E2BIG'],
    [new Error('spawn ENAMETOOLONG'), 'ENAMETOOLONG'],
    [new Error('spawn E2BIG'), 'E2BIG'],
    ...['ENOMEM', 'EINVAL', 'EBADF', 'ENOENT'].map(
      (code) => [new Error(`spawn ${code}`), undefined] as [unknown, string | undefined]
    )
  ])('recognizes only size errors with code precedence', (error, expected) => {
    expect(launchSizeErrno(error)).toBe(expected)
  })

  it('attributes values without exposing them and normalizes environment keys', () => {
    const size = summarizeLaunchInput(
      {
        command: 'cli',
        args: [
          'script',
          '--mcp-config',
          '{"x":"--secret"}',
          '--add-dir=private',
          '--add-dir',
          'other',
          '--unknown=secret',
          '--',
          '--model=secret'
        ],
        env: { A: '', a: 'secret', UNSET: undefined },
        cwd: undefined
      },
      'E2BIG'
    )
    expect(size.envEntryCount).toBe(1)
    expect(size.envBlockUtf16Units).toBe(4)
    expect(size.cwdInherited).toBe(true)
    expect(size.largestArgs).toEqual(
      [
        { index: 2, owner: '--mcp-config', utf16Units: 16, utf8Bytes: 16 },
        { index: 3, owner: '--add-dir', utf16Units: 17, utf8Bytes: 17 },
        { index: 6, owner: '<unattributed>', utf16Units: 16, utf8Bytes: 16 }
      ].sort((a, b) => b.utf8Bytes - a.utf8Bytes || a.index - b.index)
    )
  })

  it('handles empty input and deterministic ties', () => {
    const base = { command: 'cli', env: {}, cwd: '.' }
    expect(summarizeLaunchInput({ ...base, args: [] }, 'E2BIG')).toMatchObject({
      argvCount: 0,
      argvUtf8Bytes: 0,
      envBlockUtf16Units: 2,
      largestArgs: []
    })
    expect(
      summarizeLaunchInput({ ...base, args: ['a', 'b', 'c', 'd'] }, 'E2BIG').largestArgs.map(({ index }) => index)
    ).toEqual([0, 1, 2])
  })
})
