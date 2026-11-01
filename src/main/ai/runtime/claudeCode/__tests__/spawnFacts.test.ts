import { describe, expect, it } from 'vitest'

import { getClaudeCodeSpawnFacts } from '../spawnFacts'

const fingerprint = (args: string[], command = '/opt/claude') =>
  getClaudeCodeSpawnFacts(command, args).spawnArgsFingerprint

describe('Claude spawn invocation structure', () => {
  it('excludes values and installation paths before hashing', () => {
    const first = fingerprint(['/private/sdk.mjs', '--resume=T', '--model', 'sonnet', '--settings', '{"key":"secret"}'])
    expect(first).toMatch(/^claude-spawn-v1:[0-9a-f]{64}$/)
    expect(fingerprint(['/other/sdk.mjs', '--resume=U', '--model', 'opus', '--settings', '{}'], '/new/claude')).toBe(
      first
    )
    expect(fingerprint(['/other/sdk.mjs', '--resume=U', '--model', '--verbose', '--settings', '{}'])).toBe(first)
  })

  it('distinguishes known flags, order, repetition, form and executable family', () => {
    const first = fingerprint(['--resume=T', '--model', 'a'])
    for (const args of [
      ['--resume', 'T', '--model', 'a'],
      ['--resume=T'],
      ['--resume=T', '--model', 'a', '--verbose'],
      ['--model', 'a', '--resume=T'],
      ['--resume=T', '--model', 'a', '--model', 'b']
    ])
      expect(fingerprint(args)).not.toBe(first)
    expect(fingerprint(['--resume=T', '--model', 'a'], '/bin/node')).not.toBe(first)
    expect(fingerprint([], 'C:\\bin\\node.exe')).toBe(fingerprint([], '/bin/node'))
    expect(fingerprint([], '/secret/custom-binary')).toBe(fingerprint([], '/other/unrelated'))
  })

  it('erases unknown option names and values and respects the positional delimiter', () => {
    expect(fingerprint(['--secret-name=secret', '--unknown', 'secret'])).toBe(
      fingerprint(['--different-name=value', '--another', 'value'])
    )
    expect(fingerprint(['--', '--resume=T', '--model'])).toBe(fingerprint(['--', 'prompt', 'text']))
    expect(getClaudeCodeSpawnFacts('claude', ['--model', '--resume=T']).resumeToken).toBeNull()
    expect(getClaudeCodeSpawnFacts('claude', ['--', '--resume=T']).resumeToken).toBeNull()
    expect(getClaudeCodeSpawnFacts('claude', ['--resume', 'T']).resumeToken).toBe('T')
    expect(getClaudeCodeSpawnFacts('claude', ['--resume=T']).resumeToken).toBe('T')
  })
})
