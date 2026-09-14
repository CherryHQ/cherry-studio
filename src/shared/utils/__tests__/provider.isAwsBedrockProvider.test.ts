import { describe, expect, it } from 'vitest'

import type { Provider } from '@shared/data/types/provider'

import { isAwsBedrockProvider } from '../provider'

const withAuthType = (authType: Provider['authType']): Provider => ({ authType }) as Provider

describe('isAwsBedrockProvider', () => {
  it.each(['iam-aws', 'api-key-aws'] as const)('recognizes %s authentication', (authType) => {
    expect(isAwsBedrockProvider(withAuthType(authType))).toBe(true)
  })

  it('rejects non-Bedrock authentication', () => {
    expect(isAwsBedrockProvider(withAuthType('api-key'))).toBe(false)
  })
})
