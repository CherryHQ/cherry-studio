import { describe, expect, it, vi } from 'vitest'

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

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: vi.fn(async () => ({})) }
}))

import type { ExportTreeResponse, ExportTurnNode, Message } from '@shared/data/types/message'

import { buildTreeNotionBlocks } from '../topicTreeExport'

function message(id: string, role: 'user' | 'assistant', text: string): Message {
  return {
    id,
    topicId: 't1',
    parentId: null,
    role,
    data: { parts: [{ type: 'text', text }] },
    searchableText: text,
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    createdAt: '',
    updatedAt: ''
  }
}

function turn(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  variants: { id: string; text: string }[] = []
): ExportTurnNode {
  return {
    messageId: id,
    message: message(id, role, text),
    variants: variants.map((v) => ({
      messageId: v.id,
      message: message(v.id, 'assistant', v.text),
      source: 'regenerate' as const
    }))
  }
}

function buildTree(): ExportTreeResponse {
  return {
    topicId: 't1',
    topicName: 'Blocks topic',
    assistantId: null,
    activeNodeId: 'T2',
    trunk: [turn('T1', 'user', '问题'), turn('T2', 'assistant', '回答', [{ id: 'V1', text: '旧版回答' }])],
    branches: [
      {
        branchId: 'B1',
        index: 1,
        forkMessageId: 'T1',
        forkPreview: '问题',
        firstUserQuestionPreview: '分支问',
        messageCount: 1,
        turns: [turn('T3', 'user', '分支问')],
        children: []
      }
    ],
    stats: { branchCount: 1, totalMessageCount: 4 }
  }
}

describe('buildTreeNotionBlocks', () => {
  it('trunk mode renders title, trunk turns and variant toggles only', async () => {
    const blocks = await buildTreeNotionBlocks(buildTree(), 'trunk')
    const flat = JSON.stringify(blocks)
    expect(flat).toContain('# Blocks topic')
    expect(flat).toContain('问题')
    expect(flat).toContain('回答')
    // Variants become native toggle blocks (martian would drop <details> HTML)
    const toggles = blocks.filter((b) => b.type === 'toggle')
    expect(toggles).toHaveLength(1)
    expect(toggles[0].toggle.rich_text[0].text.content).toContain('export.branch.variants.regenerate')
    // No branch content in trunk mode
    expect(flat).not.toContain('分支问')
  })

  it('appendix mode appends branch sections after the trunk', async () => {
    const blocks = await buildTreeNotionBlocks(buildTree(), 'appendix')
    const flat = JSON.stringify(blocks)
    expect(flat).toContain('问题')
    expect(flat).toContain('export.branch.appendix_item:1,分支问')
    expect(flat).toContain('分支问')
    expect(flat.indexOf('回答')).toBeLessThan(flat.indexOf('export.branch.appendix_item:1,分支问'))
    expect(blocks.filter((b) => b.type === 'toggle')).toHaveLength(1)
  })
})
