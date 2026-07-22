import type { ResourceListQuery } from '@renderer/hooks/resourceCatalog'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useResourceLibrary } from '../useResourceLibrary'

const mocks = vi.hoisted(() => ({
  useAssistantList: vi.fn(),
  useAgentList: vi.fn(),
  useSkillList: vi.fn(),
  usePromptList: vi.fn(),
  useGroups: vi.fn()
}))

vi.mock('@renderer/hooks/resourceCatalog/assistantAdapter', () => ({
  assistantAdapter: {
    useList: mocks.useAssistantList
  }
}))

vi.mock('@renderer/hooks/resourceCatalog/agentAdapter', () => ({
  agentAdapter: {
    useList: mocks.useAgentList
  }
}))

vi.mock('@renderer/hooks/resourceCatalog/skillAdapter', () => ({
  skillAdapter: {
    useList: mocks.useSkillList
  }
}))

vi.mock('@renderer/hooks/resourceCatalog/promptAdapter', () => ({
  promptAdapter: {
    useList: mocks.usePromptList
  }
}))

vi.mock('@renderer/hooks/useGroups', () => ({
  useGroups: mocks.useGroups
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'agent.builtin.cherry_assistant.description' ? 'Advisor 诊断 helper' : key)
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'agent.builtin.cherry_assistant.description' ? 'Advisor 诊断 helper' : key)
  })
}))

function listResult(data: unknown[]) {
  return {
    data,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn()
  }
}

function renderResourceLibrary(options: Partial<Parameters<typeof useResourceLibrary>[0]> = {}) {
  return renderHook(() =>
    useResourceLibrary({
      resourceType: 'assistant',
      activeGroupId: null,
      search: '',
      sort: 'updatedAt',
      ...options
    })
  )
}

describe('useResourceLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useAssistantList.mockReturnValue(listResult([]))
    mocks.useAgentList.mockReturnValue(listResult([]))
    mocks.useSkillList.mockReturnValue(listResult([]))
    mocks.usePromptList.mockReturnValue(listResult([]))
    mocks.useGroups.mockReturnValue({
      groups: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
  })

  it('uses backend-resolved model names for assistant resource cards', () => {
    mocks.useAssistantList.mockReturnValue(
      listResult([
        {
          id: 'assistant-1',
          name: 'Assistant',
          description: '',
          emoji: '💬',
          modelName: 'GPT-4o',
          groupId: null,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary()

    expect(result.current.allResources).toMatchObject([{ id: 'assistant-1', type: 'assistant', model: 'GPT-4o' }])
    expect(mocks.useAssistantList.mock.calls[0]).toEqual([{ enabled: true }])
    expect(mocks.useAgentList).toHaveBeenCalledWith({ enabled: false, search: undefined })
    expect(mocks.useSkillList).toHaveBeenCalledWith({ enabled: false, search: undefined })
    expect(mocks.usePromptList).toHaveBeenCalledWith({ enabled: false, search: undefined })
  })

  it('maps assistant group ids to group names', () => {
    mocks.useGroups.mockReturnValue({
      groups: [
        {
          id: 'group-work',
          entityType: 'assistant',
          name: 'Work',
          orderKey: 'a0',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mocks.useAssistantList.mockReturnValue(
      listResult([
        {
          id: 'assistant-1',
          name: 'Assistant',
          description: '',
          emoji: '💬',
          modelName: null,
          groupId: 'group-work',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary()

    expect(result.current.allResources).toMatchObject([{ id: 'assistant-1', groupId: 'group-work', groupName: 'Work' }])
  })

  it('uses backend-resolved model names for agent resource cards', () => {
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Agent',
          description: '',
          configuration: {},
          model: 'anthropic::claude-sonnet-4-5',
          modelName: 'Claude Sonnet 4.5',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({ resourceType: 'agent' })

    expect(result.current.allResources).toMatchObject([{ id: 'agent-1', type: 'agent', model: 'Claude Sonnet 4.5' }])
    expect(mocks.useAssistantList.mock.calls[0]).toEqual([{ enabled: false }])
    expect(mocks.useAgentList).toHaveBeenCalledWith({ enabled: true, search: undefined })
  })

  it('forwards trimmed agent search to the server and retains the builtin display fallback', () => {
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Cherry Assistant',
          description: '',
          configuration: { builtin_role: 'assistant' },
          model: null,
          modelName: null,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({ resourceType: 'agent', search: '诊断' })

    expect(mocks.useAgentList).toHaveBeenCalledWith({ enabled: true, search: '诊断' })
    expect(result.current.resources.map((resource) => resource.id)).toEqual(['agent-1'])
  })

  it('does not apply a second client-only agent search filter', () => {
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Cherry Assistant',
          description: '',
          configuration: { builtin_role: 'assistant' },
          model: null,
          modelName: null,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({ resourceType: 'agent', search: 'nonexistent' })

    expect(mocks.useAgentList).toHaveBeenCalledWith({ enabled: true, search: 'nonexistent' })
    expect(result.current.resources.map((resource) => resource.id)).toEqual(['agent-1'])
  })

  it('omits the agent card model when the backend cannot resolve a modelName', () => {
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Agent',
          description: '',
          configuration: {},
          model: 'anthropic::claude-sonnet-4-5',
          modelName: null,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({ resourceType: 'agent' })

    expect(result.current.allResources[0]?.model).toBeUndefined()
  })

  it('uses the default agent avatar for blank stored agent avatars', () => {
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Agent',
          description: '',
          configuration: { avatar: '   ' },
          model: 'anthropic::claude-sonnet-4-5',
          modelName: 'Claude Sonnet 4.5',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({ resourceType: 'agent' })

    expect(result.current.allResources[0]?.avatar).toBe('🤖')
  })

  it('does not use skill source metadata tags for resource cards', () => {
    mocks.useSkillList.mockReturnValue(
      listResult([
        {
          id: 'skill-1',
          name: '网页摘要',
          description: '自动提取网页核心内容',
          folderName: 'web-summary',
          source: 'marketplace',
          sourceUrl: null,
          namespace: null,
          author: 'CherryStudio',
          sourceTags: ['metadata-only'],
          contentHash: 'hash',
          isEnabled: false,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({ resourceType: 'skill' })
    const skill = result.current.allResources.find((resource) => resource.type === 'skill')

    expect(skill?.groupName).toBeUndefined()
  })

  it('passes skill search to the backend and ignores activeGroupId', () => {
    mocks.useSkillList.mockReturnValue(
      listResult([
        {
          id: 'skill-filtered',
          name: '网页摘要',
          description: '由 /skills 返回',
          folderName: 'backend-filtered',
          source: 'marketplace',
          sourceUrl: null,
          namespace: null,
          author: null,
          sourceTags: [],
          contentHash: 'filtered-hash',
          isEnabled: false,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({
      resourceType: 'skill',
      activeGroupId: '11111111-1111-4111-8111-111111111111',
      search: ' summary '
    })

    expect(mocks.useSkillList).toHaveBeenCalledWith({ enabled: true, search: 'summary' })
    expect(mocks.useAssistantList.mock.calls[0]).toEqual([{ enabled: false }])
    expect(mocks.useAssistantList.mock.calls[1]).toEqual([{ enabled: false, search: undefined, groupId: undefined }])
    expect(result.current.resources.map((resource) => resource.id)).toEqual(['skill-filtered'])
  })

  it('maps prompt resources and forwards search without tag filters', () => {
    mocks.usePromptList.mockReturnValue(
      listResult([
        {
          id: 'prompt-filtered',
          title: '日报模板',
          content: '今日完成 ${task}',
          orderKey: 'b',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({
      resourceType: 'prompt',
      activeGroupId: '11111111-1111-4111-8111-111111111111',
      search: ' 日报 '
    })

    expect(mocks.usePromptList).toHaveBeenCalledWith({ enabled: true, search: '日报' })
    expect(result.current.resources).toMatchObject([
      {
        id: 'prompt-filtered',
        type: 'prompt',
        name: '日报模板',
        description: '今日完成 ${task}',
        avatar: 'Aa'
      }
    ])
  })

  it('forwards the selected assistant group id to filtered list reads', () => {
    const groupId = '11111111-1111-4111-8111-111111111111'
    mocks.useAssistantList.mockImplementation((query?: ResourceListQuery) => {
      if (query?.groupId) return listResult([])
      return listResult([
        {
          id: 'assistant-1',
          name: 'Assistant',
          description: '',
          emoji: '💬',
          modelName: 'GPT-4o',
          groupId,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    })

    renderResourceLibrary({ activeGroupId: groupId })

    expect(mocks.useAssistantList.mock.calls[1]).toEqual([{ enabled: true, search: undefined, groupId }])
  })

  it('ignores activeGroupId for non-assistant resources', () => {
    renderResourceLibrary({ resourceType: 'agent', activeGroupId: '11111111-1111-4111-8111-111111111111' })

    expect(mocks.useAgentList).toHaveBeenCalledWith({ enabled: true, search: undefined })
    expect(mocks.useAssistantList.mock.calls[0]).toEqual([{ enabled: false }])
    expect(mocks.useAssistantList.mock.calls[1]).toEqual([{ enabled: false, search: undefined, groupId: undefined }])
  })
})
