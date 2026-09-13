import { describe, expect, it, vi } from 'vitest'

// messageToMarkdown is mocked to a deterministic block so structure assertions
// stay independent of the export pipeline's markdown details.
vi.mock('../ExportService', () => ({
  messageToMarkdown: vi.fn(async (message) => {
    const first = message.parts?.[0]
    const text = first && first.type === 'text' ? first.text : ''
    const heading = message.role === 'user' ? '## 🧑‍💻 User' : `## 🤖 ${message.modelId ?? 'Assistant'}`
    return `${heading}\n\n${text}`
  }),
  messageToMarkdownWithReasoning: vi.fn(async () => '')
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    // Key echo with interpolation values, so labels are assertable yet stable
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${Object.values(opts).join(',')}` : key)
  }
}))

// No mock for '@cherrystudio/ui': createSlugger is a side-effect-free pure
// function, and anchor assertions must run against the real slug rules.

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: vi.fn(async () => ({ topicId: 't1' })) }
}))

import { createSlugger } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import type {
  ExportBranchNode,
  ExportTreeResponse,
  ExportTurnNode,
  ExportVariantSource,
  Message
} from '@shared/data/types/message'

import { fetchTopicExportTree, renderTopicExport } from '../topicTreeExport'

interface FixtureMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  modelId?: string
}

function sharedMessage(m: FixtureMessage): Message {
  return {
    id: m.id,
    topicId: 't1',
    parentId: null,
    role: m.role,
    data: { parts: [{ type: 'text', text: m.text }] },
    searchableText: m.text,
    status: 'success',
    siblingsGroupId: 0,
    modelId: m.modelId ?? null,
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z'
  }
}

function turn(
  m: FixtureMessage,
  variants: FixtureMessage[] = [],
  source: ExportVariantSource = 'regenerate'
): ExportTurnNode {
  return {
    messageId: m.id,
    message: sharedMessage(m),
    variants: variants.map((v) => ({ messageId: v.id, message: sharedMessage(v), source }))
  }
}

function branch(
  node: Partial<ExportBranchNode> &
    Pick<ExportBranchNode, 'branchId' | 'index' | 'forkMessageId' | 'firstUserQuestionPreview'>
): ExportBranchNode {
  return {
    messageCount: node.messageCount ?? 0,
    turns: node.turns ?? [],
    children: node.children ?? [],
    forkPreview: node.forkPreview ?? '',
    ...node
  }
}

// Tree shape:
//   trunk: T1(user) → T2(assistant modelA, +multi-model variant V2) → T3(user) → T4(assistant, +regenerate variant V4)
//   branch B1 (fork at T3): T5(user) → T6(assistant, +2 regenerate variants)
//     └─ branch B2 (fork at T6): T7(user) → T8(assistant)
function buildTree(): ExportTreeResponse {
  const t1 = turn({ id: 'T1', role: 'user', text: '什么是黑洞?' })
  const t2 = turn(
    { id: 'T2', role: 'assistant', text: '黑洞回答', modelId: 'modelA' },
    [{ id: 'V2', role: 'assistant', text: 'B 模型回答', modelId: 'modelB' }],
    'multi-model'
  )
  const t3 = turn({ id: 'T3', role: 'user', text: '质量多大?' })
  const t4 = turn(
    { id: 'T4', role: 'assistant', text: '总结回答', modelId: 'modelA' },
    [{ id: 'V4', role: 'assistant', text: '旧版总结', modelId: 'modelA' }],
    'regenerate'
  )

  const t5 = turn({ id: 'T5', role: 'user', text: '怎么观测?' })
  const t6 = turn(
    { id: 'T6', role: 'assistant', text: '观测回答', modelId: 'modelA' },
    [
      { id: 'V6a', role: 'assistant', text: '观测旧版一', modelId: 'modelA' },
      { id: 'V6b', role: 'assistant', text: '观测旧版二', modelId: 'modelA' }
    ],
    'regenerate'
  )
  const b2 = branch({
    branchId: 'B2',
    index: 2,
    forkMessageId: 'T6',
    forkPreview: '观测回答',
    firstUserQuestionPreview: '追问细节?',
    messageCount: 2,
    turns: [
      turn({ id: 'T7', role: 'user', text: '追问细节?' }),
      turn({ id: 'T8', role: 'assistant', text: '细节回答', modelId: 'modelA' })
    ]
  })
  const b1 = branch({
    branchId: 'B1',
    index: 1,
    forkMessageId: 'T3',
    forkPreview: '质量多大?',
    firstUserQuestionPreview: '怎么观测?',
    messageCount: 6,
    turns: [t5, t6],
    children: [b2]
  })
  // A branch forking right at the topic start (no fork turn) — needs a leading note
  const b3 = branch({
    branchId: 'B3',
    index: 3,
    forkMessageId: null,
    forkPreview: '',
    firstUserQuestionPreview: '另一条开局?',
    messageCount: 2,
    turns: [
      turn({ id: 'T9', role: 'user', text: '另一条开局?' }),
      turn({ id: 'T10', role: 'assistant', text: '开局回答', modelId: 'modelA' })
    ]
  })

  return {
    topicId: 't1',
    topicName: 'Branch export',
    assistantId: 'a1',
    activeNodeId: 'T4',
    trunk: [t1, t2, t3, t4],
    branches: [b1, b3],
    stats: { branchCount: 3, totalMessageCount: 16 }
  }
}

describe('renderTopicExport', () => {
  it('trunk mode renders the active chain with folded variants and no branch artifacts', async () => {
    const artifact = await renderTopicExport(buildTree(), 'trunk')
    expect(artifact.kind).toBe('single')

    const md = artifact.kind === 'single' ? artifact.markdown : ''
    expect(md.startsWith('# Branch export\n')).toBe(true)
    // All trunk turns present in order, branch content absent
    expect(md).toContain('什么是黑洞?')
    expect(md).toContain('质量多大?')
    expect(md.indexOf('什么是黑洞?')).toBeLessThan(md.indexOf('质量多大?'))
    expect(md).not.toContain('怎么观测?')
    // No fork notes, no appendix
    expect(md).not.toContain('🌿')
    expect(md).not.toContain('export.branch.appendix_title')
    // Variants fold behind their chain member; the chain member is marked selected
    expect(md).toContain('<details>')
    expect(md).toContain('export.branch.variants.models:1')
    expect(md).toContain('export.branch.variants.regenerate:1')
    expect(md).toMatch(/## 🤖 modelA export\.branch\.selected_badge/)
    expect(md).not.toMatch(/## 🧑‍💻 User export\.branch\.selected_badge/)
    // Turns stay separated by horizontal rules, matching the current export format
    expect(md).toContain('\n---\n')
  })

  it('trunk mode with blockquote variant style emits no <details> HTML', async () => {
    const artifact = await renderTopicExport(buildTree(), 'trunk', { variantStyle: 'blockquote' })
    const md = artifact.kind === 'single' ? artifact.markdown : ''
    expect(md).not.toContain('<details>')
    expect(md).toContain('> export.branch.variants.models:1')
    expect(md).toContain('> B 模型回答')
  })

  it('appendix mode adds fork notes on the trunk and appendix sections with matching anchors', async () => {
    const artifact = await renderTopicExport(buildTree(), 'appendix')
    const md = artifact.kind === 'single' ? artifact.markdown : ''

    // Fork note right behind the forked turn (T3), numbered, pointing at the appendix
    expect(md).toContain('> 🌿¹ export.branch.fork_note:怎么观测?,6')
    expect(md).toContain(`[export.branch.fork_note.appendix](#`)
    // A topic-start branch gets a leading note in front of the first turn
    expect(md).toContain('> 🌿³ export.branch.fork_note:另一条开局?,2')
    expect(md.indexOf('🌿³')).toBeLessThan(md.indexOf('什么是黑洞?'))
    // Appendix header and branch sections (nested child as its own section)
    expect(md).toContain('## 🌿 export.branch.appendix_title')
    expect(md).toContain('export.branch.appendix_item:1,怎么观测?')
    expect(md).toContain('export.branch.appendix_item:2,追问细节?')
    expect(md).toContain('export.branch.appendix_item:3,另一条开局?')
    // Return links point back at the fork turn's heading anchor
    expect(md).toMatch(/> ↩ \[export\.branch\.return_to_fork\]\(#.+\)/)

    // Anchor consistency against the REAL slugger: every appendix-bound note
    // link resolves to one of the document's heading slugs (simulated in exact
    // document order, badge-augmented turn headings included)
    const noteAnchors = [...md.matchAll(/fork_note\.appendix\]\(#([^)]+)\)/g)].map((m) => m[1])
    expect(noteAnchors).toHaveLength(2)
    const slugger = createSlugger()
    const docTitles = [
      '## 🧑‍💻 User',
      '## 🤖 modelA export.branch.selected_badge',
      '### 🤖 modelB',
      '## 🧑‍💻 User',
      '## 🤖 modelA export.branch.selected_badge',
      '### 🤖 modelA',
      '## 🌿 export.branch.appendix_title',
      '## 🌿 export.branch.appendix_item:1,怎么观测?',
      '## 🌿 export.branch.appendix_item:2,追问细节?',
      '## 🌿 export.branch.appendix_item:3,另一条开局?'
    ]
    const slugSet = new Set(docTitles.map((t) => slugger.slug(t)))
    for (const anchor of noteAnchors) {
      expect(slugSet.has(anchor)).toBe(true)
    }

    // Branch turns appear after the appendix header
    expect(md.indexOf('export.branch.appendix_title')).toBeLessThan(md.indexOf('观测回答'))
  })

  it('files mode produces one document per branch, each carrying its trunk prefix seamlessly', async () => {
    const artifact = await renderTopicExport(buildTree(), 'files')
    expect(artifact.kind).toBe('fileSet')
    if (artifact.kind !== 'fileSet') return

    expect(artifact.branches).toHaveLength(3)

    // Main document: trunk + fork note pointing at a standalone file
    expect(artifact.main.markdown).toContain('什么是黑洞?')
    // Branch *content* stays out of the main document (the fork note's preview
    // label legitimately quotes the branch's first question)
    expect(artifact.main.markdown).not.toContain('观测回答')
    expect(artifact.main.markdown).toMatch(/export\.branch\.fork_note\.file [^\s]+\.md/)
    // Topic-start branch gets its leading note in the main document too
    expect(artifact.main.markdown.indexOf('🌿³')).toBeLessThan(artifact.main.markdown.indexOf('什么是黑洞?'))

    // B1 document: title/subtitle, trunk prefix up to the fork, then branch content
    const b1 = artifact.branches.find((d) => d.fileName.startsWith('branch-1'))!
    expect(b1.markdown.startsWith('# Branch export · export.branch.file_title:1')).toBe(true)
    expect(b1.markdown).toContain('export.branch.file_subtitle:10')
    expect(b1.markdown.indexOf('什么是黑洞?')).toBeLessThan(b1.markdown.indexOf('怎么观测?'))
    expect(b1.markdown).toContain('观测回答')
    // Sub-branch fork note inside B1 points at the sub-branch file
    expect(b1.markdown).toMatch(/export\.branch\.fork_note\.file branch-2-.+\.md/)

    // B2 document: prefix spans trunk AND the parent branch chain (T5 present)
    const b2 = artifact.branches.find((d) => d.fileName.startsWith('branch-2'))!
    expect(b2.markdown).toContain('怎么观测?')
    expect(b2.markdown).toContain('追问细节?')
    expect(b2.markdown.indexOf('怎么观测?')).toBeLessThan(b2.markdown.indexOf('追问细节?'))

    // B3 document: forked at topic start — no prefix, starts from its own first turn
    const b3 = artifact.branches.find((d) => d.fileName.startsWith('branch-3'))!
    expect(b3.markdown).not.toContain('什么是黑洞?')
    expect(b3.markdown).toContain('另一条开局?')

    // No seam markers anywhere
    for (const doc of [artifact.main, ...artifact.branches]) {
      expect(doc.markdown).not.toContain('↳')
    }
  })

  it('fetchTopicExportTree requests the export-tree endpoint', async () => {
    await fetchTopicExportTree('t1')
    expect(dataApiService.get).toHaveBeenCalledWith('/topics/t1/export-tree')
  })
})
