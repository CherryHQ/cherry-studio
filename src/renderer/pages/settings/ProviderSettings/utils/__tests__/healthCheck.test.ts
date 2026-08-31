import i18n from '@renderer/i18n/resolver'
import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiKeyWithStatus, ModelWithStatus } from '../../types/healthCheck'
import { HealthStatus } from '../../types/healthCheck'
import {
  checkModelWithMultipleKeys,
  getModelCheckCredentialPolicy,
  getModelHealthCheckSkipReason,
  resolveModelCheckCredentials,
  summarizeHealthResults
} from '../../utils/healthCheck'

const { ipcRequestMock } = vi.hoisted(() => ({ ipcRequestMock: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

let previousLanguage: string

beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

const entries: ApiKeyEntry[] = [
  { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
  { id: 'key-2', key: 'sk-disabled', label: 'Disabled', isEnabled: false },
  { id: 'key-3', key: 'sk-backup', label: 'Backup', isEnabled: true }
]

function createModel(id: string, capabilities: Model['capabilities']): Model {
  return {
    id: `openai::${id}`,
    providerId: 'openai',
    name: id,
    capabilities,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

describe('checkModelWithMultipleKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses provider authentication with an explicit empty API-key override', async () => {
    ipcRequestMock.mockResolvedValueOnce({ latency: 12 })
    const credential = { kind: 'provider-auth', id: 'provider-auth', key: '' } as const

    const results = await checkModelWithMultipleKeys(createModel('chat', []), [credential], 9000)

    expect(ipcRequestMock).toHaveBeenCalledWith('ai.provider.model.check', {
      apiKeyOverride: '',
      uniqueModelId: 'openai::chat',
      timeout: 9000
    })
    expect(results).toEqual([expect.objectContaining({ kind: 'ok', credential, latency: 12 })])
  })
})

describe('summarizeHealthResults', () => {
  it('summarizes every outcome with singular English labels', () => {
    const model: Model = {
      id: 'openai::model',
      providerId: 'openai',
      name: 'Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }
    const successKey = {
      kind: 'ok',
      credential: { kind: 'api-key', entry: entries[0] },
      status: HealthStatus.SUCCESS,
      checking: false,
      latency: 1
    } satisfies ApiKeyWithStatus
    const failedKey = {
      kind: 'failed',
      credential: { kind: 'api-key', entry: entries[2] },
      status: HealthStatus.FAILED,
      checking: false,
      error: { name: 'Error', message: 'failed', stack: null }
    } satisfies ApiKeyWithStatus
    const results: ModelWithStatus[] = [
      { kind: 'ok', model, status: HealthStatus.SUCCESS, checking: false, keyResults: [successKey], latency: 1 },
      {
        kind: 'failed',
        model: { ...model, id: 'openai::partial' },
        status: HealthStatus.FAILED,
        checking: false,
        keyResults: [successKey, failedKey]
      },
      {
        kind: 'failed',
        model: { ...model, id: 'openai::failed' },
        status: HealthStatus.FAILED,
        checking: false,
        keyResults: [failedKey]
      },
      {
        kind: 'skipped',
        model: { ...model, id: 'openai::image' },
        status: HealthStatus.NOT_CHECKED,
        checking: false,
        keyResults: [],
        skipReason: { kind: 'generation_cost', output: 'image' }
      }
    ]

    expect(summarizeHealthResults(results, 'OpenAI')).toBe(
      'OpenAI: 1 model passed model checks, 1 model had inaccessible keys, 1 model completely inaccessible, 1 model skipped'
    )
  })
})

describe('getModelCheckCredentialPolicy', () => {
  it('disables API-key selection and requirements for login-based providers', () => {
    expect(getModelCheckCredentialPolicy({ authMethods: ['oauth'] }, true)).toEqual({
      canSelectApiKey: false,
      requiresApiKey: false
    })
  })

  it('allows API-key selection without requiring it for auth-optional providers', () => {
    expect(getModelCheckCredentialPolicy({ authMethods: ['api-key'], authOptional: true }, true)).toEqual({
      canSelectApiKey: true,
      requiresApiKey: false
    })
  })

  it('allows and requires API-key selection for required-key providers', () => {
    expect(getModelCheckCredentialPolicy({ authMethods: ['api-key'] }, true)).toEqual({
      canSelectApiKey: true,
      requiresApiKey: true
    })
  })
})

describe('resolveModelCheckCredentials', () => {
  it('keeps stable identity while selecting all enabled API keys', () => {
    expect(
      resolveModelCheckCredentials(entries, { mode: 'all' }, { canSelectApiKey: true, requiresApiKey: true })
    ).toEqual([
      { kind: 'api-key', entry: entries[0] },
      { kind: 'api-key', entry: entries[2] }
    ])
  })

  it('selects one enabled API key by stable id', () => {
    expect(
      resolveModelCheckCredentials(
        entries,
        { mode: 'single', keyId: 'key-3' },
        { canSelectApiKey: true, requiresApiKey: true }
      )
    ).toEqual([{ kind: 'api-key', entry: entries[2] }])
  })

  it('rejects missing or disabled selected keys with a mappable error code', () => {
    try {
      resolveModelCheckCredentials(
        entries,
        { mode: 'single', keyId: 'key-2' },
        { canSelectApiKey: true, requiresApiKey: true }
      )
      expect.unreachable('expected unavailable API key to be rejected')
    } catch (error) {
      expect(error).toMatchObject({ code: 'api_key_unavailable' })
    }
  })

  it('rejects providers that require a key when none are enabled', () => {
    try {
      resolveModelCheckCredentials([], { mode: 'all' }, { canSelectApiKey: true, requiresApiKey: true })
      expect.unreachable('expected a required API key error')
    } catch (error) {
      expect(error).toMatchObject({ code: 'api_key_required' })
    }
  })

  it('uses all enabled API keys when they are available for an auth-optional provider', () => {
    expect(
      resolveModelCheckCredentials(entries, { mode: 'all' }, { canSelectApiKey: true, requiresApiKey: false })
    ).toEqual([
      { kind: 'api-key', entry: entries[0] },
      { kind: 'api-key', entry: entries[2] }
    ])
  })

  it('uses provider authentication when an auth-optional provider has no enabled API key', () => {
    expect(resolveModelCheckCredentials([], { mode: 'all' }, { canSelectApiKey: true, requiresApiKey: false })).toEqual(
      [{ kind: 'provider-auth', id: 'provider-auth', key: '' }]
    )
  })

  it('uses provider authentication when API keys cannot be selected', () => {
    expect(
      resolveModelCheckCredentials(entries, { mode: 'all' }, { canSelectApiKey: false, requiresApiKey: false })
    ).toEqual([{ kind: 'provider-auth', id: 'provider-auth', key: '' }])
  })
})

describe('getModelHealthCheckSkipReason', () => {
  it('skips generation and speech models with an explicit reason', () => {
    expect(getModelHealthCheckSkipReason(createModel('image', [MODEL_CAPABILITY.IMAGE_GENERATION]))).toBeNull()
    expect(getModelHealthCheckSkipReason(createModel('video', [MODEL_CAPABILITY.VIDEO_GENERATION]))).toEqual({
      kind: 'unsupported_probe'
    })
    expect(getModelHealthCheckSkipReason(createModel('audio', [MODEL_CAPABILITY.AUDIO_GENERATION]))).toEqual({
      kind: 'unsupported_probe'
    })
    expect(getModelHealthCheckSkipReason(createModel('speech-to-text', [MODEL_CAPABILITY.AUDIO_TRANSCRIPT]))).toEqual({
      kind: 'unsupported_probe'
    })
  })

  it('keeps text, embedding, and rerank models available for checks', () => {
    expect(getModelHealthCheckSkipReason(createModel('chat', [MODEL_CAPABILITY.TEXT_GENERATION]))).toBeNull()
    expect(getModelHealthCheckSkipReason(createModel('embedding', [MODEL_CAPABILITY.EMBEDDING]))).toBeNull()
    expect(getModelHealthCheckSkipReason(createModel('rerank', [MODEL_CAPABILITY.RERANK]))).toBeNull()
    expect(
      getModelHealthCheckSkipReason(
        createModel('chat-and-audio', [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.AUDIO_GENERATION])
      )
    ).toBeNull()
  })
})
