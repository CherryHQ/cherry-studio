import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'

import {
  trackAssistantCreated,
  trackCodeBlockAction,
  trackModelSelected,
  trackProviderCheck
} from '../productAnalytics'

const request = vi.mocked(window.api.ipcApi.request)
const tracked = () => request.mock.calls.filter(([route]) => route === 'analytics.track').map(([, event]) => event)
const model = (providerId: string) => ({ id: `${providerId}::m`, providerId, name: 'M' }) as unknown as Model

beforeEach(() => request.mockClear())

describe('product analytics helpers', () => {
  it('names a picked model only by its built-in provider and counts a multi-model pick', () => {
    trackModelSelected('chat', [model('openai')])
    trackModelSelected('agent', [model('3f2b1c0a-user-provider')])
    trackModelSelected('chat', [model('cherryin'), model('anthropic')])
    trackModelSelected('chat', [])

    expect(tracked()).toEqual([
      { event: 'chat_model_selected', surface: 'chat', modelSource: 'own_key', target: 'openai' },
      { event: 'chat_model_selected', surface: 'agent', modelSource: 'own_key' },
      { event: 'chat_model_selected', surface: 'chat', modelSource: 'cherryin', target: 'cherryin', count: 2 }
    ])
  })

  it('reports an API check as passed or failed, naming only a built-in provider', () => {
    trackProviderCheck({ surface: 'settings', providerId: 'openai', keyCount: 2 })
    trackProviderCheck({ surface: 'setup', providerId: 'my-relay', keyCount: 1, errorReason: 'network' })

    expect(tracked()).toEqual([
      { event: 'provider_check_result', status: 'passed', surface: 'settings', keyCount: 2, target: 'openai' },
      { event: 'provider_check_result', status: 'failed', surface: 'setup', errorReason: 'network', keyCount: 1 }
    ])
  })

  it('reports an assistant library id only when it is a static preset id', () => {
    trackAssistantCreated('library', '0b5d7a52-1c7e-4f8a-9d55-2f9f8e6b1a11')
    trackAssistantCreated('library', 'My Custom Preset')
    trackAssistantCreated('blank')

    expect(tracked()).toEqual([
      { event: 'assistant_created', source: 'library', target: '0b5d7a52-1c7e-4f8a-9d55-2f9f8e6b1a11' },
      { event: 'assistant_created', source: 'library' },
      { event: 'assistant_created', source: 'blank' }
    ])
  })

  it('names a code block language only when the caller vouches it has a special view', () => {
    trackCodeBlockAction('preview_opened', 'html')
    trackCodeBlockAction('copy')

    expect(tracked()).toEqual([
      { event: 'code_block_action', action: 'preview_opened', language: 'html' },
      { event: 'code_block_action', action: 'copy' }
    ])
  })
})
