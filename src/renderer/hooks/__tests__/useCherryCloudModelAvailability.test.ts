import type { Model } from '@shared/data/types/model'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCherryCloudModelFilter } from '../useCherryCloudModelAvailability'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: vi.fn()
}))

function model(providerId: string, modelId: string): Model {
  return {
    id: `${providerId}::${modelId}`,
    providerId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

function wrapper() {
  const cache = new Map()
  return ({ children }: PropsWithChildren) => createElement(SWRConfig, { value: { provider: () => cache } }, children)
}

describe('useCherryCloudModelFilter', () => {
  beforeEach(() => {
    mocks.ipcRequest.mockReset()
  })

  it("uses each model's server-provided module features independently of provider edition", async () => {
    const agentOnly = model('cherryai-subscription', 'agent-only')
    const shared = model('cherryai-subscription', 'shared')
    const regular = model('openai', 'gpt-4o')
    mocks.ipcRequest.mockResolvedValue({
      entitledModelIds: [agentOnly.id, shared.id],
      freeModelIds: [agentOnly.id],
      availableModelIdsByFeature: {
        agent: [agentOnly.id, shared.id],
        chat: [shared.id],
        translate: [shared.id]
      },
      quotaExhaustedModelIds: []
    })

    const { result } = renderHook(
      () => ({
        agent: useCherryCloudModelFilter('agent'),
        chat: useCherryCloudModelFilter('chat'),
        translate: useCherryCloudModelFilter('translate')
      }),
      { wrapper: wrapper() }
    )

    await waitFor(() => expect(result.current.agent(agentOnly)).toBe(true))
    expect(result.current.chat(agentOnly)).toBe(false)
    expect(result.current.translate(agentOnly)).toBe(false)
    expect(result.current.agent(shared)).toBe(true)
    expect(result.current.chat(shared)).toBe(true)
    expect(result.current.translate(shared)).toBe(true)
    expect(result.current.chat(regular)).toBe(true)
  })
})
