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

  it('gives up quickly on a block nested deeper than it can match', () => {
    const readme = `"mcpServers": {${'a'.repeat(28)}{{{}}}`
    const startedAt = performance.now()

    expect(getMcpConfigSampleFromReadme(readme)).toBeNull()
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })
})
