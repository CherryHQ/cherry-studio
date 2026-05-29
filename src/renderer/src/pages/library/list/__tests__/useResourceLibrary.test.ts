import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceListQuery } from '../../adapters/types'
import { useResourceLibrary } from '../useResourceLibrary'

const mocks = vi.hoisted(() => ({
  useAssistantList: vi.fn(),
  useAgentList: vi.fn(),
  useSkillList: vi.fn(),
  usePromptList: vi.fn(),
  useTagList: vi.fn()
}))

vi.mock('../../adapters/assistantAdapter', () => ({
  assistantAdapter: {
    useList: mocks.useAssistantList
  }
}))

vi.mock('../../adapters/agentAdapter', () => ({
  agentAdapter: {
    useList: mocks.useAgentList
  }
}))

vi.mock('../../adapters/skillAdapter', () => ({
  skillAdapter: {
    useList: mocks.useSkillList
  }
}))

vi.mock('../../adapters/promptAdapter', () => ({
  promptAdapter: {
    useList: mocks.usePromptList
  }
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useTagList: mocks.useTagList
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
      sidebarFilter: { resourceType: 'assistant' },
      activeTag: null,
      search: '',
      sort: 'updatedAt',
      ...options
    })
  )
}

describe('useResourceLibrary model display names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useAssistantList.mockReturnValue(listResult([]))
    mocks.useAgentList.mockReturnValue(listResult([]))
    mocks.useSkillList.mockReturnValue(listResult([]))
    mocks.usePromptList.mockReturnValue(listResult([]))
    mocks.useTagList.mockReturnValue({
      tags: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
  })

  it('uses backend-resolved model names for both assistant and agent resource cards', () => {
    mocks.useAssistantList.mockReturnValue(
      listResult([
        {
          id: 'assistant-1',
          name: 'Assistant',
          description: '',
          emoji: '💬',
          modelName: 'GPT-4o',
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )
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

    const { result } = renderResourceLibrary()

    expect(result.current.allResources.find((resource) => resource.type === 'assistant')?.model).toBe('GPT-4o')
    expect(result.current.allResources.find((resource) => resource.type === 'agent')?.model).toBe('Claude Sonnet 4.5')
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

    const { result } = renderResourceLibrary()

    expect(result.current.allResources.find((resource) => resource.type === 'agent')?.model).toBeUndefined()
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

    const { result } = renderResourceLibrary({
      sidebarFilter: { resourceType: 'skill' }
    })
    const skill = result.current.allResources.find((resource) => resource.type === 'skill')

    expect(skill?.tags).toEqual([])
  })

  it('passes skill search to the backend and ignores activeTag', () => {
    mocks.useSkillList.mockImplementation((query?: ResourceListQuery) => {
      if (query) {
        return listResult([
          {
            id: 'skill-filtered',
            name: '后端结果',
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
      }

      return listResult([
        {
          id: 'skill-base',
          name: '网页摘要',
          description: '自动提取网页核心内容',
          folderName: 'web-summary',
          source: 'marketplace',
          sourceUrl: null,
          namespace: null,
          author: null,
          sourceTags: ['metadata-only'],
          contentHash: 'base-hash',
          isEnabled: false,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    })

    const { result } = renderResourceLibrary({
      sidebarFilter: { resourceType: 'skill' },
      activeTag: '生产力',
      search: ' summary '
    })

    expect(mocks.useSkillList.mock.calls[0]).toEqual([])
    expect(mocks.useSkillList.mock.calls[1]).toEqual([{ search: 'summary' }])
    expect(result.current.resources.map((resource) => resource.id)).toEqual(['skill-filtered'])
  })

  it('maps prompt resources and forwards search without tag filters', () => {
    mocks.usePromptList.mockImplementation((query?: ResourceListQuery) => {
      if (query) {
        return listResult([
          {
            id: 'prompt-filtered',
            title: '日报模板',
            content: '今日完成 ${task}',
            orderKey: 'b',
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z'
          }
        ])
      }

      return listResult([
        {
          id: 'prompt-base',
          title: '会议纪要',
          content: '总结会议内容',
          orderKey: 'a',
          createdAt: '2026-04-26T00:00:00.000Z',
          updatedAt: '2026-04-26T00:00:00.000Z'
        }
      ])
    })

    const { result } = renderResourceLibrary({
      sidebarFilter: { resourceType: 'prompt' },
      activeTag: '生产力',
      search: ' 日报 '
    })

    expect(mocks.usePromptList.mock.calls[0]).toEqual([])
    expect(mocks.usePromptList.mock.calls[1]).toEqual([{ search: '日报' }])
    expect(result.current.typeCounts.prompt).toBe(1)
    expect(result.current.resources).toMatchObject([
      {
        id: 'prompt-filtered',
        type: 'prompt',
        name: '日报模板',
        description: '今日完成 ${task}',
        avatar: 'Aa',
        tags: []
      }
    ])
  })

  it('resolves the selected assistant tag to tagIds for filtered list reads', () => {
    mocks.useAssistantList.mockImplementation((query?: ResourceListQuery) => {
      if (query?.tagIds) return listResult([])
      return listResult([
        {
          id: 'assistant-1',
          name: 'Assistant',
          description: '',
          emoji: '💬',
          modelName: 'GPT-4o',
          tags: [{ id: 'tag-1', name: 'work', color: '#3b82f6' }],
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    })

    renderResourceLibrary({ activeTag: 'work' })

    expect(mocks.useAssistantList.mock.calls[1]).toEqual([{ search: undefined, tagIds: ['tag-1'] }])
  })

  it('returns an empty list when a selected assistant tag cannot be resolved', () => {
    const { result } = renderResourceLibrary({ activeTag: 'missing' })

    expect(mocks.useAssistantList.mock.calls[1]).toEqual([{ search: undefined, tagIds: undefined }])
    expect(result.current.resources).toEqual([])
  })

  it('ignores activeTag for non-assistant resources', () => {
    renderResourceLibrary({ sidebarFilter: { resourceType: 'agent' }, activeTag: 'work' })

    expect(mocks.useAgentList.mock.calls[1]).toEqual([{ search: undefined }])
    expect(mocks.useAssistantList.mock.calls[1]).toEqual([{ search: undefined, tagIds: undefined }])
  })
})
