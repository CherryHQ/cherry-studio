/**
 * Topic tree export renderer
 *
 * Renders a server-assembled `ExportTreeResponse` into the three branch-export
 * artifacts (see task 09-04-branch-export design.md):
 * - `trunk`:   active-path chain only, variants folded per turn
 * - `appendix`: single document — trunk + fork notes + branch appendix
 * - `files`:   file set — main document + one standalone branch document per
 *              branch, each carrying its trunk prefix so it reads as a natural
 *              linear conversation with no seam markers.
 *
 * All jumps are standard markdown links (heading anchors / relative file
 * links): GitHub and Obsidian render them clickable; import-based targets
 * (SiYuan, Yuque) degrade to readable text without losing content.
 */

import { createSlugger } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import i18n from '@renderer/i18n/resolver'
import type { MessageExportView } from '@renderer/types/messageExport'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { withPriorCitationParts } from '@renderer/utils/message/exportView'
import type {
  ExportBranchNode,
  ExportTreeResponse,
  ExportTurnNode,
  ExportVariantLeaf,
  ExportVariantSource,
  Message
} from '@shared/data/types/message'
import { toContentRole } from '@shared/data/types/message'

import { messageToMarkdown, messageToMarkdownWithReasoning } from './ExportService'

// ============================================================================
// Public interface
// ============================================================================

export type BranchExportMode = 'trunk' | 'appendix' | 'files'

export interface TopicExportOptions {
  /** Variant fold style: `<details>` (default, matches reasoning blocks) or blockquote (Word pipeline). */
  variantStyle?: 'details' | 'blockquote'
  /** Include reasoning/thinking sections (mirrors the legacy "export reasoning" preference). */
  exportReasoning?: boolean
}

export interface ExportedDoc {
  fileName: string
  title: string
  markdown: string
}

export type ExportArtifact =
  | { kind: 'single'; markdown: string }
  | { kind: 'fileSet'; main: ExportedDoc; branches: ExportedDoc[] }

const TURN_SEPARATOR = '\n---\n'

/** Load the whole-tree export model from the Data API (one round trip, no pagination). */
export async function fetchTopicExportTree(topicId: string): Promise<ExportTreeResponse> {
  return (await dataApiService.get(`/topics/${topicId}/export-tree`)) as ExportTreeResponse
}

// ============================================================================
// Shared→view mapping (mirrors `convertSharedMessage` in useTopic.ts; kept
// local so the service layer never imports from a hook module)
// ============================================================================

function toExportView(message: Message): MessageExportView {
  return {
    id: message.id,
    topicId: message.topicId,
    role: toContentRole(message.role),
    status: message.status,
    parts: message.data?.parts ?? [],
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    parentId: message.parentId ?? undefined,
    modelId: message.modelId ?? undefined,
    ...(message.messageSnapshot && { messageSnapshot: message.messageSnapshot }),
    ...(message.stats && { stats: message.stats })
  }
}

// ============================================================================
// Turn rendering (block cache — one messageToMarkdown pass reused everywhere)
// ============================================================================

interface TurnBlock {
  /** First line of the rendered message block, e.g. `## 🧑‍💻 User` (used for anchor slugs) */
  headingTitle: string
  /** Full message markdown (heading + content) */
  block: string
}

function variantSummaryKey(source: ExportVariantSource): string {
  if (source === 'multi-model') return 'export.branch.variants.models'
  if (source === 'edit-resend') return 'export.branch.variants.edit_resend'
  return 'export.branch.variants.regenerate'
}

function variantSummaryText(source: ExportVariantSource, turn: ExportTurnNode): string {
  // Snapshot display name only — the raw composite modelId is an internal id and must not leak into exports
  const chainModel = turn.message.messageSnapshot?.model?.name ?? ''
  return i18n.t(variantSummaryKey(source), {
    count: turn.variants.length,
    model: chainModel
  })
}

/** Demote a message block's leading `##` to `###` so variants nest under their chain member. */
function demoteHeading(markdown: string): string {
  return markdown.replace(/^## /, '### ')
}

class TurnRenderer {
  private readonly blocks = new Map<string, TurnBlock>()
  private readonly variantBlocks = new Map<string, string>()
  private readonly viewsById = new Map<string, MessageExportView>()
  private readonly converter: typeof messageToMarkdown

  constructor(
    private readonly style: 'details' | 'blockquote',
    exportReasoning: boolean
  ) {
    this.converter = exportReasoning ? messageToMarkdownWithReasoning : messageToMarkdown
  }

  /**
   * Pre-resolve cross-message citations once for the whole tree: later turns
   * re-citing an earlier tool's `[cite:id]` must resolve like the legacy
   * pipeline (`getTopicMessages` runs `withPriorCitationParts` at the end).
   */
  primeCitations(turns: ExportTurnNode[]): void {
    const views = withPriorCitationParts(
      turns.flatMap((t) => [t.message, ...t.variants.map((v) => v.message)]).map(toExportView)
    )
    for (const view of views) {
      this.viewsById.set(view.id, view)
    }
  }

  private viewOf(message: Message): MessageExportView {
    return this.viewsById.get(message.id) ?? toExportView(message)
  }

  /** Render (or fetch cached) the chain-member block of a turn. */
  async blockOf(turn: ExportTurnNode): Promise<TurnBlock> {
    const cached = this.blocks.get(turn.messageId)
    if (cached) return cached
    const markdown = await this.converter(this.viewOf(turn.message))
    const firstNewline = markdown.indexOf('\n')
    const block: TurnBlock = {
      headingTitle: firstNewline === -1 ? markdown : markdown.slice(0, firstNewline),
      block: markdown
    }
    this.blocks.set(turn.messageId, block)
    return block
  }

  /** Render (or fetch cached) the folded-variants section trailing a turn (empty when none). */
  async variantsOf(turn: ExportTurnNode): Promise<string> {
    if (turn.variants.length === 0) return ''
    const summary = variantSummaryText(turn.variants[0].source, turn)
    const parts: string[] = []
    for (const variant of turn.variants) {
      let block = this.variantBlocks.get(variant.messageId)
      if (block === undefined) {
        block = demoteHeading(await this.converter(this.viewOf(variant.message)))
        this.variantBlocks.set(variant.messageId, block)
      }
      parts.push(block)
    }
    if (this.style === 'blockquote') {
      const lines = [`> ${summary}`, '']
      for (const part of parts) {
        for (const line of part.split('\n')) {
          lines.push(line.length > 0 ? `> ${line}` : '>')
        }
        lines.push('>')
      }
      // Collapse the trailing separator quote
      return lines.slice(0, -1).join('\n')
    }
    return `<details>\n<summary>${summary}</summary>\n\n${parts.join('\n\n')}\n\n</details>`
  }

  /**
   * The turn's heading line as it appears in the final document — the raw
   * heading plus the selected badge when variants exist. Both the section
   * renderer and the anchor-slug pass must derive slugs from THIS text or the
   * generated anchors point at headings that don't exist.
   */
  private async documentHeadingTitle(turn: ExportTurnNode): Promise<string> {
    const block = await this.blockOf(turn)
    // Mark the chain member as the picked version only where alternatives exist
    return turn.variants.length > 0
      ? `${block.headingTitle} ${i18n.t('export.branch.selected_badge')}`
      : block.headingTitle
  }

  /** Full turn section: message block (with a selected badge when variants exist) + folded variants. */
  async turnSection(turn: ExportTurnNode): Promise<string> {
    const block = await this.blockOf(turn)
    const headingTitle = await this.documentHeadingTitle(turn)
    const heading =
      block.headingTitle === headingTitle ? block.block : headingTitle + block.block.slice(block.headingTitle.length)
    const variants = await this.variantsOf(turn)
    return variants.length > 0 ? `${heading}\n\n${variants}` : heading
  }

  /** Heading titles of a turn in document order (chain member first, then variant headings). */
  async headingTitlesOf(turn: ExportTurnNode): Promise<string[]> {
    const titles = [await this.documentHeadingTitle(turn)]
    for (const variant of turn.variants) {
      const block = this.variantBlocks.get(variant.messageId)
      if (block) {
        const firstNewline = block.indexOf('\n')
        titles.push(firstNewline === -1 ? block : block.slice(0, firstNewline))
      }
    }
    return titles
  }
}

// ============================================================================
// Tree helpers
// ============================================================================

interface ChainPosition {
  chainTurns: ExportTurnNode[]
  chainPrefix: ExportTurnNode[]
  indexInChain: number
}

/** Flatten branches in breadth-first order (matches server-assigned display indices). */
function flattenBranches(branches: ExportBranchNode[]): ExportBranchNode[] {
  const ordered: ExportBranchNode[] = []
  const queue = [...branches]
  while (queue.length > 0) {
    const branch = queue.shift()!
    ordered.push(branch)
    queue.push(...branch.children)
  }
  return ordered
}

/**
 * Index every chain message id → its chain and position, plus each branch id →
 * its trunk prefix (drives standalone-document assembly and fork notes).
 */
function buildChainIndex(tree: ExportTreeResponse): {
  byMessage: Map<string, ChainPosition>
  prefixByBranch: Map<string, ExportTurnNode[]>
} {
  const byMessage = new Map<string, ChainPosition>()
  const prefixByBranch = new Map<string, ExportTurnNode[]>()
  const walk = (turns: ExportTurnNode[], prefix: ExportTurnNode[]) => {
    turns.forEach((turn, i) => {
      if (!byMessage.has(turn.messageId)) {
        byMessage.set(turn.messageId, { chainTurns: turns, chainPrefix: prefix, indexInChain: i })
      }
    })
  }
  walk(tree.trunk, [])

  // Prefix of a branch = fork chain's prefix + fork chain's turns up to and
  // including the fork message ("trunk prefix" of the standalone document).
  const prefixOf = (branch: ExportBranchNode): ExportTurnNode[] => {
    const forkId = branch.forkMessageId
    if (!forkId) return []
    const fork = byMessage.get(forkId)
    if (!fork) return []
    return [...fork.chainPrefix, ...fork.chainTurns.slice(0, fork.indexInChain + 1)]
  }

  const walkBranch = (branch: ExportBranchNode) => {
    const prefix = prefixOf(branch)
    prefixByBranch.set(branch.branchId, prefix)
    walk(branch.turns, prefix)
    branch.children.forEach(walkBranch)
  }
  tree.branches.forEach(walkBranch)
  return { byMessage, prefixByBranch }
}

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹'
}

/** `12` → `¹²` — keeps fork-note numbering visually attached to the 🌿 marker. */
function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPT_DIGITS[d] ?? d)
    .join('')
}

function branchFileName(branch: ExportBranchNode): string {
  const cleaned = removeSpecialCharactersForFileName(branch.firstUserQuestionPreview).slice(0, 20).trim()
  const suffix = cleaned.length > 0 ? cleaned : 'branch'
  return `branch-${branch.index}-${suffix}.md`
}

/** Group branches by their fork message so multiple forks at one position stack as note lines. */
function branchesByFork(branches: ExportBranchNode[]): Map<string, ExportBranchNode[]> {
  const map = new Map<string, ExportBranchNode[]>()
  for (const branch of branches) {
    const key = branch.forkMessageId ?? ''
    const list = map.get(key) ?? []
    list.push(branch)
    map.set(key, list)
  }
  return map
}

// ============================================================================
// Document assembly
// ============================================================================

interface ForkNoteTarget {
  kind: 'appendix'
  anchor: string
}

interface FileNoteTarget {
  kind: 'file'
  fileName: string
}

type NoteTarget = ForkNoteTarget | FileNoteTarget

function forkNoteLine(branch: ExportBranchNode, target: NoteTarget): string {
  const label = i18n.t('export.branch.fork_note', {
    preview: branch.firstUserQuestionPreview,
    count: branch.messageCount
  })
  const link =
    target.kind === 'appendix'
      ? `[${i18n.t('export.branch.fork_note.appendix')}](#${target.anchor})`
      : `[${i18n.t('export.branch.fork_note.file')} ${target.fileName}](./${encodeURIComponent(target.fileName)})`
  return `> 🌿${superscript(branch.index)} ${label} → ${link}`
}

/**
 * Render one chain's turns. When `noteTargetFor` is provided, fork notes are
 * appended behind fork messages; without it the chain renders plain (forks are
 * represented by nested sections or separate files instead).
 */
async function renderChain(
  turns: ExportTurnNode[],
  forkMap: Map<string, ExportBranchNode[]>,
  renderer: TurnRenderer,
  noteTargetFor?: (branch: ExportBranchNode) => NoteTarget
): Promise<string> {
  const groups: string[] = []
  // Branches forking at the topic start (forkMessageId null, keyed '') get a
  // leading note in front of the first turn — otherwise their appendix
  // sections would be unreachable from the body.
  const leading = forkMap.get('')
  if (leading && noteTargetFor) {
    groups.push(leading.map((b) => forkNoteLine(b, noteTargetFor(b))).join('\n'))
  }
  for (const turn of turns) {
    const parts = [await renderer.turnSection(turn)]
    const forks = forkMap.get(turn.messageId)
    if (forks && noteTargetFor) {
      parts.push(forks.map((b) => forkNoteLine(b, noteTargetFor(b))).join('\n'))
    }
    groups.push(parts.filter(Boolean).join('\n\n'))
  }
  return groups.filter(Boolean).join(TURN_SEPARATOR)
}

/** Assemble the branch appendix: one section per branch (children nested after their parent). */
async function renderAppendix(
  branches: ExportBranchNode[],
  forkAnchorFor: (forkMessageId: string | null) => string | null,
  renderer: TurnRenderer
): Promise<string> {
  const sections: string[] = []
  for (const branch of branches) {
    const heading = `## 🌿 ${i18n.t('export.branch.appendix_item', {
      index: branch.index,
      preview: branch.firstUserQuestionPreview
    })}`
    const returnAnchor = forkAnchorFor(branch.forkMessageId)
    const returnLine =
      returnAnchor !== null
        ? `> ↩ [${i18n.t('export.branch.return_to_fork')}](#${returnAnchor})`
        : `> ↩ ${i18n.t('export.branch.return_to_fork')}`
    // No fork notes inside an appendix section: child branches render as their
    // own sibling sections right after (flat headings, BFS order) so heading
    // depth stays constant no matter the nesting.
    const body = await renderChain(branch.turns, new Map(), renderer)
    const children = await renderAppendix(branch.children, forkAnchorFor, renderer)
    sections.push([heading, '', returnLine, '', body, children].filter(Boolean).join('\n\n'))
  }
  return sections.filter(Boolean).join(TURN_SEPARATOR)
}

export async function renderTopicExport(
  tree: ExportTreeResponse,
  mode: BranchExportMode,
  options: TopicExportOptions = {}
): Promise<ExportArtifact> {
  const renderer = new TurnRenderer(options.variantStyle ?? 'details', options.exportReasoning ?? false)
  const ordered = flattenBranches(tree.branches)
  // Resolve cross-message citations once, then pre-render every turn (trunk +
  // all branches) so both the slug pass and the assembly pass reuse blocks.
  renderer.primeCitations(tree.trunk)
  for (const branch of ordered) {
    renderer.primeCitations(branch.turns)
  }
  for (const turn of tree.trunk) {
    await renderer.turnSection(turn)
  }
  for (const branch of ordered) {
    for (const turn of branch.turns) {
      await renderer.turnSection(turn)
    }
  }

  if (mode === 'trunk') {
    const body = await renderChain(tree.trunk, new Map(), renderer)
    return { kind: 'single', markdown: `# ${tree.topicName}\n\n${body}`.trimEnd() + '\n' }
  }

  if (mode === 'appendix') {
    // Slug pass — simulate the final document's headings in exact document
    // order (chain members, their variant headings, appendix heading, then
    // each branch section's headings) so anchors match what renderers like
    // GitHub dedupe to when several turns share the same heading text.
    const slugger = createSlugger()
    const turnAnchor = new Map<string, string>()
    const assignChain = async (turns: ExportTurnNode[]) => {
      for (const turn of turns) {
        for (const title of await renderer.headingTitlesOf(turn)) {
          const slug = slugger.slug(title)
          if (!turnAnchor.has(turn.messageId)) {
            turnAnchor.set(turn.messageId, slug)
          }
        }
      }
    }
    await assignChain(tree.trunk)

    const branchAnchor = new Map<string, string>()
    const appendBranchSlugs = async (branches: ExportBranchNode[]) => {
      for (const branch of branches) {
        const heading = `## 🌿 ${i18n.t('export.branch.appendix_item', {
          index: branch.index,
          preview: branch.firstUserQuestionPreview
        })}`
        branchAnchor.set(branch.branchId, slugger.slug(heading))
        await assignChain(branch.turns)
        await appendBranchSlugs(branch.children)
      }
    }
    slugger.slug(`## 🌿 ${i18n.t('export.branch.appendix_title')}`)
    await appendBranchSlugs(tree.branches)

    const forkMapTop = branchesByFork(tree.branches)
    const forkAnchorFor = (forkMessageId: string | null): string | null =>
      forkMessageId !== null ? (turnAnchor.get(forkMessageId) ?? null) : null

    const body = await renderChain(tree.trunk, forkMapTop, renderer, (b) => ({
      kind: 'appendix',
      anchor: branchAnchor.get(b.branchId) ?? ''
    }))
    const appendix = await renderAppendix(tree.branches, forkAnchorFor, renderer)
    const appendixHeader = `## 🌿 ${i18n.t('export.branch.appendix_title')}`
    const markdown = [`# ${tree.topicName}`, '', body, '', '---', '', appendixHeader, '', appendix]
      .filter(Boolean)
      .join('\n\n')
    return { kind: 'single', markdown: markdown.trimEnd() + '\n' }
  }

  // mode === 'files'
  const { prefixByBranch } = buildChainIndex(tree)
  const fileNameFor = new Map<string, string>(ordered.map((b) => [b.branchId, branchFileName(b)]))
  const forkMapTop = branchesByFork(tree.branches)

  const mainBody = await renderChain(tree.trunk, forkMapTop, renderer, (b) => ({
    kind: 'file',
    fileName: fileNameFor.get(b.branchId) ?? ''
  }))
  const main: ExportedDoc = {
    fileName: `${removeSpecialCharactersForFileName(tree.topicName) || 'topic'}.md`,
    title: tree.topicName,
    markdown: `# ${tree.topicName}\n\n${mainBody}`.trimEnd() + '\n'
  }

  const branchDocs: ExportedDoc[] = []
  for (const branch of ordered) {
    const prefix = prefixByBranch.get(branch.branchId) ?? []
    const title = `${tree.topicName} · ${i18n.t('export.branch.file_title', { index: branch.index })}`
    const subtitle = i18n.t('export.branch.file_subtitle', {
      // Same unit as branch.messageCount: chain members + their folded variants
      count: prefix.reduce((n, t) => n + 1 + t.variants.length, 0) + branch.messageCount
    })
    // Fork notes inside a branch document point at the sub-branch files
    const body = await renderChain(branch.turns, branchesByFork(branch.children), renderer, (b) => ({
      kind: 'file',
      fileName: fileNameFor.get(b.branchId) ?? ''
    }))
    const markdown = [
      `# ${title}`,
      '',
      subtitle,
      '',
      [await chainText(prefix, renderer), body].filter(Boolean).join(TURN_SEPARATOR)
    ]
      .filter(Boolean)
      .join('\n\n')
    branchDocs.push({ fileName: fileNameFor.get(branch.branchId) ?? '', title, markdown: markdown.trimEnd() + '\n' })
  }

  return { kind: 'fileSet', main, branches: branchDocs }
}

async function chainText(turns: ExportTurnNode[], renderer: TurnRenderer): Promise<string> {
  const sections: string[] = []
  for (const turn of turns) {
    sections.push(await renderer.turnSection(turn))
  }
  return sections.filter(Boolean).join(TURN_SEPARATOR)
}

// ============================================================================
// Notion blocks assembly (martian drops raw HTML, so `<details>` folds must
// become native toggle blocks instead)
// ============================================================================

/** Build the branch-aware Notion block list for the given export mode. */
export async function buildTreeNotionBlocks(tree: ExportTreeResponse, mode: BranchExportMode): Promise<any[]> {
  const { convertMarkdownToNotionBlocks } = await import('./ExportService')

  const titleBlocks = await convertMarkdownToNotionBlocks(`# ${tree.topicName}`)

  const variantToggle = async (
    source: ExportVariantSource,
    chain: ExportTurnNode,
    variant: ExportVariantLeaf
  ): Promise<any> => {
    const children = await convertMarkdownToNotionBlocks(await messageToMarkdown(toExportView(variant.message)))
    return {
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [
          {
            type: 'text',
            text: { content: variantSummaryText(source, chain) },
            annotations: { bold: true }
          }
        ],
        children
      }
    }
  }

  const turnBlocks = async (turn: ExportTurnNode): Promise<any[]> => {
    const blocks = await convertMarkdownToNotionBlocks(await messageToMarkdown(toExportView(turn.message)))
    const toggles =
      turn.variants.length > 0 ? await Promise.all(turn.variants.map((v) => variantToggle(v.source, turn, v))) : []
    return [...blocks, ...toggles]
  }

  const chainBlocks = async (turns: ExportTurnNode[]): Promise<any[]> =>
    (await Promise.all(turns.map(turnBlocks))).flat()

  const branchBlocks = async (branch: ExportBranchNode): Promise<any[]> => {
    const heading = await convertMarkdownToNotionBlocks(
      `## 🌿 ${i18n.t('export.branch.appendix_item', {
        index: branch.index,
        preview: branch.firstUserQuestionPreview
      })}`
    )
    const note = branch.forkMessageId
      ? await convertMarkdownToNotionBlocks(`> ↩ ${i18n.t('export.branch.return_to_fork')} · ${branch.forkPreview}`)
      : []
    const body = await chainBlocks(branch.turns)
    const children = (await Promise.all(branch.children.map(branchBlocks))).flat()
    return [...heading, ...note, ...body, ...children]
  }

  const trunkBlocks = await chainBlocks(tree.trunk)
  if (mode === 'trunk') {
    return [...titleBlocks, ...trunkBlocks]
  }
  const branches = (await Promise.all(tree.branches.map(branchBlocks))).flat()
  return [...titleBlocks, ...trunkBlocks, ...branches]
}
