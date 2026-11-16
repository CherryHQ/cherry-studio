import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadTestConfig, mockTestConfig } from '../config'

it('loads both protocol endpoints from the run-owned mock port without repository configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-mock-config-'))
  try {
    writeFileSync(join(directory, 'mock.json'), JSON.stringify({ port: 43210 }))
    const { customProvider } = loadTestConfig(directory)
    expect(customProvider.baseUrl).toBe('http://127.0.0.1:43210/v1')
    expect(customProvider.anthropicBaseUrl).toBe('http://127.0.0.1:43210')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.each([undefined, null, 0, -1, 65536, 123.5, 'https://external.example'])(
  'rejects an invalid mock port %s',
  (port) => {
    expect(() => mockTestConfig(port as number)).toThrow('Invalid mock provider port')
  }
)
