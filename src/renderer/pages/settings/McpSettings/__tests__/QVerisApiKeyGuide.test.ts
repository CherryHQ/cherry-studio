import { describe, expect, it } from 'vitest'

import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import { isQVerisApiKeyMissing } from '../QVerisApiKeyGuide'

describe('isQVerisApiKeyMissing', () => {
  it('requires a non-empty API key only for QVeris', () => {
    expect(isQVerisApiKeyMissing({ name: BuiltinMcpServerNames.qveris, env: { QVERIS_API_KEY: '' } })).toBe(true)
    expect(isQVerisApiKeyMissing({ name: BuiltinMcpServerNames.qveris, env: { QVERIS_API_KEY: '  ' } })).toBe(true)
    expect(isQVerisApiKeyMissing({ name: BuiltinMcpServerNames.qveris, env: { QVERIS_API_KEY: 'key' } })).toBe(false)
    expect(isQVerisApiKeyMissing({ name: 'manual-server', env: {} })).toBe(false)
  })
})
