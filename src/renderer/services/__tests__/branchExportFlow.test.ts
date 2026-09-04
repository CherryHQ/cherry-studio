import { beforeEach, describe, expect, it, vi } from 'vitest'

// Deterministic message blocks so artifact assertions stay structural
vi.mock('../ExportService', () => ({
  messageToMarkdown: vi.fn(async (message) => {
    const first = message.parts?.[0]
    const text = first && first.type === 'text' ? first.text : ''
    return `## ${message.role === 'user' ? '🧑‍💻 User' : '🤖 Assistant'}\n\n${text}`
  }),
  messageToMarkdownWithReasoning: vi.fn(async () => ''),
  convertMarkdownToNotionBlocks: vi.fn(async (markdown: string) => [{ type: 'paragraph', markdown }])
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${Object.values(opts).join(',')}` : key)
  }
}))

const popupShow = vi.fn()
vi.mock('@renderer/components/BranchExportModePopup', () => ({
  default: { show: (...args: unknown[]) => popupShow(...args) }
}))

import { dataApiService } from '@data/DataApiService'
import type { ExportTreeResponse, TreeResponse } from '@shared/data/types/message'

import { prepareTopicExport } from '../branchExportFlow'

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: vi.fn() }
}))

const lightTreeWithoutBranches = (): TreeResponse => ({
  nodes: [
    { id: 'T1', parentId: 'root', role: 'user', preview: 'q', status: 'success', createdAt: '', hasChildren: true },
    { id: 'T2', parentId: 'T1', role: 'assistant', preview: 'a', status: 'success', createdAt: '', hasChildren: false }
  ],
  siblingsGroups: [],
  activeNodeId: 'T2',
  rootId: 'root'
})

const lightTreeWithBranch = (): TreeResponse => ({
  nodes: [
    { id: 'T1', parentId: 'root', role: 'user', preview: 'q', status: 'success', createdAt: '', hasChildren: true },
    { id: 'T2', parentId: 'T1', role: 'assistant', preview: 'a', status: 'success', createdAt: '', hasChildren: true },
    {
      id: 'B1',
      parentId: 'T1',
      role: 'user',
      preview: 'branch q',
      status: 'success',
      createdAt: '',
      hasChildren: false
    }
  ],
  siblingsGroups: [],
  activeNodeId: 'T2',
  rootId: 'root'
})

const fullTree = (): ExportTreeResponse => ({
  topicId: 't1',
  topicName: 'Topic',
  assistantId: null,
  activeNodeId: 'T2',
  trunk: [
    {
      messageId: 'T1',
      message: {
        id: 'T1',
        topicId: 't1',
        parentId: null,
        role: 'user',
        data: { parts: [{ type: 'text', text: '问题' }] },
        searchableText: '',
        status: 'success',
        siblingsGroupId: 0,
        modelId: null,
        createdAt: '',
        updatedAt: ''
      },
      variants: []
    }
  ],
  branches: [
    {
      branchId: 'B1',
      index: 1,
      forkMessageId: 'T1',
      forkPreview: '问题',
      firstUserQuestionPreview: 'branch q',
      messageCount: 1,
      turns: [],
      children: []
    }
  ],
  stats: { branchCount: 1, totalMessageCount: 2 }
})

describe('prepareTopicExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('short-circuits to legacy for topics without branches (no dialog)', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue(lightTreeWithoutBranches())
    const prepared = await prepareTopicExport({ topicId: 't1', supportsFileSet: true })
    expect(prepared).toEqual({ path: 'legacy' })
    expect(dataApiService.get).toHaveBeenCalledWith('/topics/t1/tree', { query: { depth: -1 } })
    expect(popupShow).not.toHaveBeenCalled()
  })

  it('returns null when the user cancels the scope dialog', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue(lightTreeWithBranch())
    popupShow.mockResolvedValue(null)
    const prepared = await prepareTopicExport({ topicId: 't1', supportsFileSet: true })
    expect(prepared).toBeNull()
    expect(popupShow).toHaveBeenCalledWith({ branchCount: 1, messageCount: 3, supportsFileSet: true })
  })

  it('renders the chosen mode from the full export tree', async () => {
    vi.mocked(dataApiService.get).mockImplementation(async (path: string) =>
      path === '/topics/t1/tree' ? lightTreeWithBranch() : fullTree()
    )
    popupShow.mockResolvedValue('appendix')
    const prepared = await prepareTopicExport({ topicId: 't1', supportsFileSet: false })
    expect(prepared).not.toBeNull()
    expect(prepared && prepared.path === 'tree').toBe(true)
    if (prepared && prepared.path === 'tree') {
      expect(prepared.mode).toBe('appendix')
      expect(prepared.artifact.kind).toBe('single')
      // Appendix mode: the dialog stats come from the light tree; the artifact
      // from the full tree renders the trunk plus the appendix
      expect(prepared.artifact.markdown).toContain('问题')
      expect(prepared.artifact.markdown).toContain('export.branch.appendix_title')
    }
    expect(dataApiService.get).toHaveBeenCalledWith('/topics/t1/export-tree')
  })
})
