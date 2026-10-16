import { existsSync, readFileSync } from 'node:fs'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { parse } from 'dotenv'

const envFile = new URL('../../../.env', import.meta.url)
export const environment = { ...(existsSync(envFile) ? parse(readFileSync(envFile)) : {}), ...process.env }
export const secretValues = Object.entries(environment)
  .filter(([key, value]) => /API_KEY|PASSWORD|TOKEN|SECRET/.test(key) && value)
  .map(([, value]) => value!)

export function agentModel() {
  for (const key of ['BASE_URL', 'CHAT_MODEL', 'API_KEY']) {
    if (!environment[`CHERRY_TEST_CUSTOM_PROVIDER_${key}`])
      throw new Error(`Missing CHERRY_TEST_CUSTOM_PROVIDER_${key}`)
  }
  const baseURL = new URL(environment.CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL!)
  if (baseURL.pathname === '/') baseURL.pathname = '/v1'
  return createOpenAICompatible({
    name: 'test-agent',
    baseURL: baseURL.toString().replace(/\/$/, ''),
    apiKey: environment.CHERRY_TEST_CUSTOM_PROVIDER_API_KEY,
    transformRequestBody:
      baseURL.hostname === 'api.deepseek.com' ? (body) => ({ ...body, thinking: { type: 'disabled' } }) : undefined
  }).chatModel(environment.CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL!)
}
