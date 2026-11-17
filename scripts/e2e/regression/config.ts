import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RegressionTestConfig {
  customProvider: {
    baseUrl: string
    anthropicBaseUrl: string
    apiKey: string
    chatModel: string
  }
}

export function mockTestConfig(port: number): RegressionTestConfig {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid mock provider port')
  return {
    customProvider: {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      anthropicBaseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'mock-key-not-checked',
      chatModel: 'mock-chat'
    }
  }
}

export function loadTestConfig(runDirectory = process.env.CHERRY_TEST_RUN_DIR): RegressionTestConfig {
  if (!runDirectory) throw new Error('An initialized mock run directory is required')
  const record = JSON.parse(readFileSync(join(runDirectory, 'mock.json'), 'utf8'))
  return mockTestConfig(record.port)
}

export function getSensitiveConfigValues(): string[] {
  return ['mock-key-not-checked']
}
