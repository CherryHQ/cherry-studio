import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { ProviderListSchema } from '../schemas/provider'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const providers = ProviderListSchema.parse(JSON.parse(readFileSync(join(dataDir, 'providers.json'), 'utf8'))).providers

it('keeps the SiliconFlow API key link on the Cherry Studio referral URL', () => {
  expect(providers.find((provider) => provider.id === 'silicon')?.metadata.website.apiKey).toBe(
    'https://cloud.siliconflow.cn/i/d1nTBKXU'
  )
})
