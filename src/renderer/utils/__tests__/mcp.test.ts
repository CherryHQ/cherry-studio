import { describe, expect, it } from 'vitest'

import { getMcpConfigSampleFromReadme } from '../mcp'

describe('getMcpConfigSampleFromReadme', () => {
  it('returns the first npx server from an mcpServers block', () => {
    const readme = [
      '```json',
      '{ "mcpServers": { "fs": { "command": "npx", "args": ["-y", "server-fs"], "env": { "DEBUG": "1" } } } }',
      '```'
    ].join('\n')

    expect(getMcpConfigSampleFromReadme(readme)).toEqual({
      command: 'npx',
      args: ['-y', 'server-fs'],
      env: { DEBUG: '1' }
    })
  })

  it('skips blocks whose first server is not npx', () => {
    const readme = '"mcpServers": { "a": { "command": "node" } } then "mcpServers": { "b": { "command": "npx" } }'

    expect(getMcpConfigSampleFromReadme(readme)).toEqual({ command: 'npx' })
  })

  it.each([{ command: 'uvx', args: ['other-server'] }, { url: 'https://example.test/mcp' }, null])(
    'finds an npx sample after an unrelated entry in the same block: %j',
    (first) => {
      const sample = { command: 'npx', args: ['-y', '@example/server', '--stdio'], env: { API_KEY: 'your-key' } }
      const readme = JSON.stringify({ mcpServers: { existing: first, example: sample } })

      expect(getMcpConfigSampleFromReadme(readme)).toEqual(sample)
    }
  )

  it('keeps the first eligible npx sample when multiple entries match', () => {
    const first = { command: 'npx', args: ['-y', '@example/first'] }
    const readme = JSON.stringify({
      mcpServers: { first, second: { command: 'npx', args: ['-y', '@example/second'] } }
    })

    expect(getMcpConfigSampleFromReadme(readme)).toEqual(first)
  })

  it('gives up quickly on a block nested deeper than it can match', () => {
    const readme = `"mcpServers": {${'a'.repeat(28)}{{{}}}`
    const startedAt = performance.now()

    expect(getMcpConfigSampleFromReadme(readme)).toBeNull()
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })

  it('keeps scanning after an empty mcpServers block', () => {
    const readme =
      '"mcpServers": {} and later "mcpServers": { "fs": { "command": "npx", "args": ["-y", "server-fs"] } }'

    expect(getMcpConfigSampleFromReadme(readme)).toEqual({
      command: 'npx',
      args: ['-y', 'server-fs']
    })
  })

  it('keeps scanning when the first server entry is null', () => {
    const readme = '"mcpServers": { "broken": null } then "mcpServers": { "fs": { "command": "npx" } }'

    expect(getMcpConfigSampleFromReadme(readme)).toEqual({ command: 'npx' })
  })
})
