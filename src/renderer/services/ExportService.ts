import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type { Client } from '@notionhq/client'
// Known same-tier soft-edge (inherited from the former utils/export):
// `getTopicMessages` is a non-React data accessor that happens to live in the
// `useTopic` hook module, so this is a service -> hook import. Sinking the
// accessor below the hooks tier is deferred as out of scope here.
import { getTopicMessages } from '@renderer/hooks/useTopic'
import { getProviderLabelKey } from '@renderer/i18n/label'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { addNote } from '@renderer/services/NotesService'
import { toast } from '@renderer/services/toast'
import type { ExportableMessage } from '@renderer/types/messageExport'
import type { Topic } from '@renderer/types/topic'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import { getTitleFromString, messagesToPlainText, processCitations } from '@renderer/utils/export'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { captureScrollableAsBlob, captureScrollableAsDataUrl } from '@renderer/utils/image'
import { convertMathFormula, markdownToPlainText } from '@renderer/utils/markdown'
import { stripCitationMarkers } from '@renderer/utils/message/citations'
import { getComposerTextFromMessage } from '@renderer/utils/message/composerTokens'
import {
  getCitationContent,
  getMainTextContent,
  getNamingTextContent,
  getThinkingContent,
  getToolCitationExport
} from '@renderer/utils/message/find'
import type { ContentHash } from '@shared/data/types/file'
import { AbsoluteFilePathSchema, type FileVersion } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import type { markdownToBlocks } from '@tryfabric/martian'
import dayjs from 'dayjs'
import DOMPurify from 'dompurify'
import type { Blockquote } from 'mdast'
import type { appendBlocks } from 'notion-helper'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import {
  collectExportableImages,
  hydrateDeferredImageOutputs,
  type ImageExportMode,
  type PendingImageWrite,
  serializeMessagesWithImages,
  writeImageAssets
} from './markdownImageExport'

const logger = loggerService.withContext('ExportService')

let notionDependenciesPromise: Promise<{
  Client: typeof Client
  markdownToBlocks: typeof markdownToBlocks
  appendBlocks: typeof appendBlocks
}> | null = null

const loadNotionDependencies = () => {
  notionDependenciesPromise ??= Promise.all([
    import('@notionhq/client'),
    import('@tryfabric/martian'),
    import('notion-helper')
  ])
    .then(([{ Client }, { markdownToBlocks }, { appendBlocks }]) => ({ Client, markdownToBlocks, appendBlocks }))
    .catch((error) => {
      // Drop the rejected promise so a retry reloads the chunks instead of replaying the failure.
      notionDependenciesPromise = null
      throw error
    })

  return notionDependenciesPromise
}

/** Block conversion runs before executeNotionExport's own catch, so it needs the same failure face. */
const runNotionExport = async (build: () => Promise<boolean>): Promise<boolean> => {
  try {
    return await build()
  } catch (error) {
    logger.error('Notion export failed:', error as Error)
    toast.error(i18n.t('message.error.notion.export'))
    return false
  }
}

// Single export-in-progress mutex shared by every exporter below
// (markdown / Notion / Yuque / Obsidian / Joplin / Siyuan): a second export
// started while one is still running is rejected with a warning toast. This
// mutable runtime state is what classifies the module as a `service` (runtime
// logic) rather than a pure `util`.
let exportState = false

const getExportState = () => exportState
const setExportingState = (isExporting: boolean) => {
  exportState = isExporting
}

/**
 * 安全地处理思维链内容，保留安全的 HTML 标签如 <br>，移除危险内容
 *
 * 支持的标签：
 * - 结构：br, p, div, span, h1-h6, blockquote
 * - 格式：strong, b, em, i, u, s, del, mark, small, sup, sub
 * - 列表：ul, ol, li
 * - 代码：code, pre, kbd, var, samp
 * - 表格：table, thead, tbody, tfoot, tr, td, th
 *
 * @param content 原始思维链内容
 * @returns 安全处理后的内容
 */
const sanitizeReasoningContent = (content: string): string => {
  // 先处理换行符转换为 <br>
  const contentWithBr = content.replace(/\n/g, '<br>')

  // 使用 DOMPurify 清理内容，保留常用的安全标签和属性
  return DOMPurify.sanitize(contentWithBr, {
    ALLOWED_TAGS: [
      // 换行和基础结构
      'br',
      'p',
      'div',
      'span',
      // 文本格式化
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'del',
      'mark',
      'small',
      // 上标下标（数学公式、引用等）
      'sup',
      'sub',
      // 标题
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      // 引用
      'blockquote',
      // 列表
      'ul',
      'ol',
      'li',
      // 代码相关
      'code',
      'pre',
      'kbd',
      'var',
      'samp',
      // 表格（AI输出中可能包含表格）
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      // 分隔线
      'hr'
    ],
    ALLOWED_ATTR: [
      // 安全的通用属性
      'class',
      'title',
      'lang',
      'dir',
      // code 标签的语言属性
      'data-language',
      // 表格属性
      'colspan',
      'rowspan',
      // 列表属性
      'start',
      'type'
    ],
    KEEP_CONTENT: true, // 保留被移除标签的文本内容
    RETURN_DOM: false,
    SANITIZE_DOM: true,
    // 允许的协议（预留，虽然目前没有允许链接标签）
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
  })
}

const getRoleText = async (
  role: string,
  modelName?: string,
  providerId?: string,
  author?: { name: string; emoji?: string }
): Promise<string> => {
  const { showModelNameInMarkdown, showModelProviderInMarkdown } = await preferenceService.getMultiple({
    showModelNameInMarkdown: 'data.export.markdown.show_model_name',
    showModelProviderInMarkdown: 'data.export.markdown.show_model_provider'
  })
  if (role === 'user') {
    return '🧑‍💻 User'
  } else if (role === 'system') {
    return '🤖 System'
  } else {
    // Prefer the frozen producing author (survives rename/delete); fall back to the generic label.
    const emoji = author?.emoji || '🤖'
    const authorLabel = author?.name || 'Assistant'
    let assistantText = `${emoji} `
    if (showModelNameInMarkdown && modelName) {
      // Author-first (mirrors the on-screen header); model is secondary when the author is known.
      assistantText += author?.name ? `${authorLabel} | ${modelName}` : modelName
      if (showModelProviderInMarkdown && providerId) {
        const providerDisplayName = i18n.t(getProviderLabelKey(providerId), { defaultValue: providerId })
        assistantText += ` | ${providerDisplayName}`
        return assistantText
      }
      return assistantText
    } else if (showModelProviderInMarkdown && providerId) {
      const providerDisplayName = i18n.t(getProviderLabelKey(providerId), { defaultValue: providerId })
      assistantText += `${authorLabel} | ${providerDisplayName}`
      return assistantText
    }
    return assistantText + authorLabel
  }
}

/**
 * 标准化引用内容为Markdown脚注格式
 * @param citations 引用列表
 * @returns Markdown脚注格式的引用内容
 */
const formatCitationsAsFootnotes = (citations: string): string => {
  if (!citations.trim()) return ''

  // 将引用列表转换为脚注格式
  const lines = citations.split('\n\n')
  const footnotes = lines.map((line) => {
    const match = line.match(/^\[(\d+)\]\s*(.+)/)
    if (match) {
      const [, num, content] = match
      return `[^${num}]: ${content}`
    }
    return line
  })

  return footnotes.join('\n\n')
}

const createBaseMarkdown = async (
  message: ExportableMessage,
  includeReasoning: boolean = false,
  excludeCitations: boolean = false,
  normalizeCitations: boolean = true,
  rawContentOverride?: string
): Promise<{ titleSection: string; reasoningSection: string; contentSection: string; citation: string }> => {
  const forceDollarMathInMarkdown = await preferenceService.get('data.export.markdown.force_dollar_math')
  const author = 'messageSnapshot' in message ? message.messageSnapshot : undefined
  // Fall back to the frozen author's model when the projection didn't populate a live `model`
  // (e.g. topic exports), so the model/provider still render when those export prefs are on.
  const model = message.model ?? author?.model
  const roleText = await getRoleText(message.role, model?.name, model?.provider, author)
  const titleSection = `## ${roleText}`
  let reasoningSection = ''

  if (includeReasoning) {
    let reasoningContent = getThinkingContent(message)
    if (reasoningContent) {
      if (reasoningContent.startsWith('<think>\n')) {
        reasoningContent = reasoningContent.substring(8)
      } else if (reasoningContent.startsWith('<think>')) {
        reasoningContent = reasoningContent.substring(7)
      }
      // 使用 DOMPurify 安全地处理思维链内容
      reasoningContent = sanitizeReasoningContent(reasoningContent)
      // The model cites its sources while reasoning too, but the `[N]` numbering below
      // belongs to the answer body — strip rather than resolve, so no internal marker
      // survives and no second, conflicting sequence appears.
      reasoningContent = stripCitationMarkers(reasoningContent)
      if (forceDollarMathInMarkdown) {
        reasoningContent = convertMathFormula(reasoningContent)
      }
      reasoningSection = `<div style="border: 2px solid #dddddd; border-radius: 10px;">
  <details style="padding: 5px;">
    <summary>${i18n.t('common.reasoning_content')}</summary>
    ${reasoningContent}
  </details>
</div>
`
    }
  }

  // Image-bearing exports pass an interleaved text+image serialization here (already
  // composer-token processed) and bypass the shared extraction — user messages would
  // otherwise have their parts text re-extracted, dropping the images again.
  const rawContent =
    rawContentOverride !== undefined
      ? rawContentOverride
      : getComposerTextFromMessage(message, getMainTextContent(message))
  // Tool-derived citations live as `[cite:id]` markers in the text with no persisted
  // reference metadata, so resolve them to plain `[N]` here — otherwise the internal
  // marker leaks into the export and the sources list comes back empty. Messages that
  // do carry reference metadata keep the legacy path (see `getToolCitationExport`).
  const { content, citation: toolCitation } = getToolCitationExport(message, rawContent)
  let citation = excludeCitations ? '' : getCitationContent(message) || toolCitation

  let processedContent = forceDollarMathInMarkdown ? convertMathFormula(content) : content

  // 处理引用标记
  if (excludeCitations) {
    processedContent = processCitations(processedContent, 'remove')
  } else if (normalizeCitations) {
    processedContent = processCitations(processedContent, 'normalize')
    citation = formatCitationsAsFootnotes(citation)
  }

  return { titleSection, reasoningSection, contentSection: processedContent, citation }
}

export async function getMessageTitle(message: ExportableMessage, length = 30): Promise<string> {
  const content = getNamingTextContent(message)

  // Read from v2 Preference (`data.export.markdown.use_topic_naming_for_message_title`)
  // — the v1 Redux key was migrated; the renderer settings page reads the same
  // Preference key, so a stale read here would diverge from the settings UI value.
  const useTopicNaming = await preferenceService.get('data.export.markdown.use_topic_naming_for_message_title')
  if (useTopicNaming) {
    try {
      const titlePromise = fetchMessagesSummary({ messages: [message] })
      toast.loading({ title: i18n.t('chat.topics.export.wait_for_title_naming'), promise: titlePromise })
      const { text: title } = await titlePromise

      if (title) {
        toast.success(i18n.t('chat.topics.export.title_naming_success'))
        return title
      }
    } catch (e) {
      toast.error(i18n.t('chat.topics.export.title_naming_failed'))
      logger.error('Failed to generate title using topic naming, downgraded to default logic', e as Error)
    }
  }

  let title = getTitleFromString(content, length)

  if (!title) {
    title = dayjs(message.createdAt).format('YYYYMMDDHHmm')
  }

  return title
}

export const messageToMarkdown = async (
  message: ExportableMessage,
  excludeCitations?: boolean,
  rawContentOverride?: string
): Promise<string> => {
  const { excludeCitationsInExport, standardizeCitationsInExport } = await preferenceService.getMultiple({
    excludeCitationsInExport: 'data.export.markdown.exclude_citations',
    standardizeCitationsInExport: 'data.export.markdown.standardize_citations'
  })
  const shouldExcludeCitations = excludeCitations ?? excludeCitationsInExport
  const { titleSection, contentSection, citation } = await createBaseMarkdown(
    message,
    false,
    shouldExcludeCitations,
    standardizeCitationsInExport,
    rawContentOverride
  )
  return [titleSection, '', contentSection, citation].join('\n')
}

export const messageToMarkdownWithReasoning = async (
  message: ExportableMessage,
  excludeCitations?: boolean,
  rawContentOverride?: string
): Promise<string> => {
  const { excludeCitationsInExport, standardizeCitationsInExport } = await preferenceService.getMultiple({
    excludeCitationsInExport: 'data.export.markdown.exclude_citations',
    standardizeCitationsInExport: 'data.export.markdown.standardize_citations'
  })
  const shouldExcludeCitations = excludeCitations ?? excludeCitationsInExport
  const { titleSection, reasoningSection, contentSection, citation } = await createBaseMarkdown(
    message,
    true,
    shouldExcludeCitations,
    standardizeCitationsInExport,
    rawContentOverride
  )
  return [titleSection, '', reasoningSection, contentSection, citation].join('\n')
}

export const messagesToMarkdown = async (
  messages: ExportableMessage[],
  exportReasoning?: boolean,
  excludeCitations?: boolean,
  rawContentOverrides?: Map<string, string>
): Promise<string> => {
  const converter = exportReasoning ? messageToMarkdownWithReasoning : messageToMarkdown
  const markdowns = await Promise.all(
    messages.map((message) => converter(message, excludeCitations, rawContentOverrides?.get(message.id)))
  )
  return markdowns.join('\n---\n')
}

export const topicToMarkdown = async (
  topic: Topic,
  exportReasoning?: boolean,
  excludeCitations?: boolean,
  rawContentOverrides?: Map<string, string>,
  messagesOverride?: ExportableMessage[]
): Promise<string> => {
  const topicName = `# ${topic.name}`

  // Callers that already read the topic (image export collects refs from a snapshot)
  // pass it back so collection and rendering can never diverge mid-export.
  const messages = messagesOverride ?? (await getTopicMessages(topic.id))

  if (messages && messages.length > 0) {
    return (
      topicName + '\n\n' + (await messagesToMarkdown(messages, exportReasoning, excludeCitations, rawContentOverrides))
    )
  }

  return topicName
}

export const topicToPlainText = async (topic: Topic): Promise<string> => {
  const topicName = markdownToPlainText(topic.name).trim()

  const topicMessages = await getTopicMessages(topic.id)

  if (topicMessages && topicMessages.length > 0) {
    return topicName + '\n\n' + messagesToPlainText(topicMessages)
  }

  return topicName
}

export const exportMarkdownContentAsFile = async (title: string, markdown: string): Promise<void> => {
  if (getExportState()) {
    toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  setExportingState(true)

  const markdownExportPath = await preferenceService.get('data.export.markdown.path')
  if (!markdownExportPath) {
    try {
      const fileName = removeSpecialCharactersForFileName(title) + '.md'
      const result = await window.api.file.save(fileName, markdown)
      if (result) {
        toast.success(i18n.t('message.success.markdown.export.specified'))
      }
    } catch (error: any) {
      toast.error(i18n.t('message.error.markdown.export.specified'))
      logger.error('Failed to export markdown content:', error)
    } finally {
      setExportingState(false)
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const fileName = removeSpecialCharactersForFileName(title) + ` ${timestamp}.md`
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      toast.success(i18n.t('message.success.markdown.export.preconf'))
    } catch (error: any) {
      toast.error(i18n.t('message.error.markdown.export.preconf'))
      logger.error('Failed to export markdown content:', error)
    } finally {
      setExportingState(false)
    }
  }
}

/** Containing directory of a saved file path, tolerating both path separators. */
const dirOf = (filePath: string): string => {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (idx < 0) return filePath
  const dir = filePath.slice(0, idx) || '/'
  // A bare drive letter is not a usable directory — keep its separator ('C:\a.md' → 'C:\').
  return /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir
}

/**
 * UI decision injected by the hook entry points (services must not import
 * components or render UI — renderer-architecture §2). Null = the user cancelled;
 * undefined = no implementation available (both abort).
 */
export type ImageModeChooser = (imageCount: number) => Promise<ImageExportMode | null | undefined>

/**
 * Image-mode gate for Markdown file exports: collect images, ask the user how to
 * carry them via the injected chooser (only consulted when images exist), then
 * serialize when a carrying mode is chosen. Returns null when the user cancels —
 * the caller aborts without any file write.
 */
const buildMarkdownWithImages = async (
  messages: ExportableMessage[],
  build: (rawContentOverrides?: Map<string, string>) => Promise<string>,
  chooseImageMode?: ImageModeChooser
): Promise<{ markdown: string; pendingWrites: PendingImageWrite[] } | null> => {
  // Deferred generate_image outputs hydrate once here so collection and
  // serialization share one resolved snapshot.
  const { messages: hydrated, unresolvedCount: deferredUnresolved } = await hydrateDeferredImageOutputs(messages)
  const { refs, unresolvedCount } = await collectExportableImages(hydrated)
  const unresolved = deferredUnresolved + unresolvedCount
  if (refs.length === 0) {
    if (unresolved > 0) {
      toast.warning(i18n.t('chat.topics.export.image_mode.skipped', { count: unresolved }))
    }
    return { markdown: await build(), pendingWrites: [] }
  }
  // undefined = no chooser injected (service called without UI context); null = user cancelled.
  const mode = chooseImageMode ? await chooseImageMode(refs.length) : undefined
  if (mode === undefined) {
    logger.warn('No image-mode chooser provided; aborting an image-bearing markdown export')
    return null
  }
  if (mode === null || mode === 'none') {
    return mode === null ? null : { markdown: await build(), pendingWrites: [] }
  }
  const { overrides, pendingWrites, skippedCount } = await serializeMessagesWithImages(hydrated, mode, refs)
  const totalSkipped = skippedCount + unresolved
  if (totalSkipped > 0) {
    // Embed mode skips oversized OR unreadable images; folder mode has no size
    // cap, so its skips (and collection failures) are purely availability.
    const key =
      mode === 'embed' ? 'chat.topics.export.image_mode.skipped_embed' : 'chat.topics.export.image_mode.skipped'
    toast.warning(i18n.t(key, { count: totalSkipped }))
  }
  return { markdown: await build(overrides), pendingWrites }
}

const escapeAssetName = (fileName: string): string => fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Strips the failed images' assets/ links from the just-written .md; the atomic
// conditional write refuses when the file changed since expectedVersion (user edits win).
const repairDanglingImageLinks = async (
  mdPath: string,
  markdown: string,
  failedFileNames: string[],
  expectedVersion: FileVersion,
  expectedContentHash: ContentHash | undefined
): Promise<void> => {
  let repaired = markdown
  for (const fileName of failedFileNames) {
    // 'g' clears every occurrence of a deduped asset name; the alt class excludes
    // '[' and '\n' so a stray unpaired '![' in user text can never widen the match.
    repaired = repaired.replace(
      new RegExp(`!\\[[^\\][\\n]*\\]\\(assets/${escapeAssetName(fileName)}\\)\\n{0,2}`, 'g'),
      ''
    )
  }
  if (repaired === markdown) {
    logger.warn('No dangling image links matched during the markdown repair', { mdPath, failedFileNames })
    return
  }
  await ipcApi.request('file.write_if_unchanged', {
    handle: createFilePathHandle(AbsoluteFilePathSchema.parse(mdPath)),
    data: new TextEncoder().encode(repaired),
    expectedVersion,
    expectedContentHash
  })
}

// Returns the version+hash pair only while the .md still holds exactly our markdown —
// an external rewrite voids the repair; the hash closes same-second mtime ambiguity (FAT32/SMB/NFS).
const readWrittenMarkdownVersion = async (
  mdPath: string,
  markdown: string
): Promise<{ version: FileVersion; contentHash?: ContentHash } | null> => {
  try {
    const { content, version, contentHash } = await ipcApi.request('file.read', {
      handle: createFilePathHandle(AbsoluteFilePathSchema.parse(mdPath)),
      options: { mode: 'full', encoding: 'binary', withContentHash: true }
    })
    return new TextDecoder().decode(content) === markdown ? { version, contentHash } : null
  } catch {
    return null
  }
}

/** Folder mode: write image assets next to the .md; failed images get their links stripped and warn. */
const exportImageAssets = async (
  mdPath: string,
  markdown: string,
  pendingWrites: PendingImageWrite[]
): Promise<void> => {
  if (pendingWrites.length === 0) return
  const failed = await writeImageAssets(dirOf(mdPath), pendingWrites)
  if (failed.length === 0) return
  // Read back only on failure — the content-equality gate protects external
  // rewrites, and the all-assets-succeeded path pays no extra IPC.
  const snapshot = await readWrittenMarkdownVersion(mdPath, markdown)
  if (snapshot) {
    try {
      await repairDanglingImageLinks(mdPath, markdown, failed, snapshot.version, snapshot.contentHash)
    } catch (error) {
      logger.warn('Failed to strip dangling image links from the exported markdown', { mdPath, error })
    }
  } else {
    logger.warn('Skipped the dangling-link repair: the exported .md no longer holds this export', { mdPath })
  }
  toast.warning(i18n.t('chat.topics.export.image_mode.write_failed', { count: failed.length }))
}

export const exportTopicAsMarkdown = async (
  topic: Topic,
  exportReasoning?: boolean,
  excludeCitations?: boolean,
  chooseImageMode?: ImageModeChooser
): Promise<void> => {
  if (getExportState()) {
    toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  setExportingState(true)

  const markdownExportPath = await preferenceService.get('data.export.markdown.path')
  if (!markdownExportPath) {
    try {
      const fileName = removeSpecialCharactersForFileName(topic.name) + '.md'
      const messages = await getTopicMessages(topic.id)
      const built = await buildMarkdownWithImages(
        messages ?? [],
        (overrides) => topicToMarkdown(topic, exportReasoning, excludeCitations, overrides, messages ?? []),
        chooseImageMode
      )
      if (!built) return
      const result = await window.api.file.save(fileName, built.markdown)
      if (result) {
        await exportImageAssets(result, built.markdown, built.pendingWrites)
        toast.success(i18n.t('message.success.markdown.export.specified'))
      }
    } catch (error: any) {
      toast.error(i18n.t('message.error.markdown.export.specified'))
      logger.error('Failed to export topic as markdown:', error)
    } finally {
      setExportingState(false)
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const fileName = removeSpecialCharactersForFileName(topic.name) + ` ${timestamp}.md`
      const messages = await getTopicMessages(topic.id)
      const built = await buildMarkdownWithImages(
        messages ?? [],
        (overrides) => topicToMarkdown(topic, exportReasoning, excludeCitations, overrides, messages ?? []),
        chooseImageMode
      )
      if (!built) return
      const mdPath = markdownExportPath + '/' + fileName
      await window.api.file.write(mdPath, built.markdown)
      await exportImageAssets(mdPath, built.markdown, built.pendingWrites)
      toast.success(i18n.t('message.success.markdown.export.preconf'))
    } catch (error: any) {
      toast.error(i18n.t('message.error.markdown.export.preconf'))
      logger.error('Failed to export topic as markdown:', error)
    } finally {
      setExportingState(false)
    }
  }
}

export const exportMessageAsMarkdown = async (
  message: ExportableMessage,
  exportReasoning?: boolean,
  excludeCitations?: boolean,
  chooseImageMode?: ImageModeChooser
): Promise<void> => {
  if (getExportState()) {
    toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  setExportingState(true)

  const buildWithOverrides = async (overrides?: Map<string, string>): Promise<string> => {
    const rawContentOverride = overrides?.get(message.id)
    return exportReasoning
      ? await messageToMarkdownWithReasoning(message, excludeCitations, rawContentOverride)
      : await messageToMarkdown(message, excludeCitations, rawContentOverride)
  }

  const markdownExportPath = await preferenceService.get('data.export.markdown.path')
  if (!markdownExportPath) {
    try {
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + '.md'
      const built = await buildMarkdownWithImages([message], buildWithOverrides, chooseImageMode)
      if (!built) return
      const result = await window.api.file.save(fileName, built.markdown)
      if (result) {
        await exportImageAssets(result, built.markdown, built.pendingWrites)
        toast.success(i18n.t('message.success.markdown.export.specified'))
      }
    } catch (error: any) {
      toast.error(i18n.t('message.error.markdown.export.specified'))
      logger.error('Failed to export message as markdown:', error)
    } finally {
      setExportingState(false)
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + ` ${timestamp}.md`
      const built = await buildMarkdownWithImages([message], buildWithOverrides, chooseImageMode)
      if (!built) return
      const mdPath = markdownExportPath + '/' + fileName
      await window.api.file.write(mdPath, built.markdown)
      await exportImageAssets(mdPath, built.markdown, built.pendingWrites)
      toast.success(i18n.t('message.success.markdown.export.preconf'))
    } catch (error: any) {
      toast.error(i18n.t('message.error.markdown.export.preconf'))
      logger.error('Failed to export message as markdown:', error)
    } finally {
      setExportingState(false)
    }
  }
}

// GitHub-style alert marker (e.g. "[!NOTE]") leading the first paragraph inside a quote
const ALERT_MARKER_RE = /^\[!([A-Za-z][\w-]*)\]/

// Fixed alert-type → Notion callout icon/color pairs (issue #16388 spec)
const ALERT_CALLOUT_MAP: Record<string, { emoji: string; color: string }> = {
  NOTE: { emoji: '💡', color: 'blue_background' },
  TIP: { emoji: '✅', color: 'green_background' },
  IMPORTANT: { emoji: '⭐', color: 'purple_background' },
  WARNING: { emoji: '⚠️', color: 'yellow_background' },
  CAUTION: { emoji: '🚫', color: 'red_background' }
}
const UNKNOWN_ALERT_CALLOUT = { emoji: '📝', color: 'gray_background' }

const stripLeadingNewline = (segment: any): any =>
  segment?.text ? { ...segment, text: { ...segment.text, content: segment.text.content.replace(/^\n/, '') } } : segment

// Detect alert quotes on the source mdast, mirroring the live renderer
// (remark-github-blockquote-alert): the marker must lead the quote's first
// paragraph as a plain text node. Source-level detection keeps provenance that
// martian strips (raw HTML like <code>[!NOTE]</code> becomes plain text).
const isAlertQuoteNode = (quote: Blockquote): boolean => {
  const firstChild = quote.children?.[0]
  if (firstChild?.type !== 'paragraph') {
    return false
  }
  const firstNode = firstChild.children?.[0]
  return firstNode?.type === 'text' && ALERT_MARKER_RE.test(firstNode.value)
}

// One flag per source blockquote in document order, consumed in the same order below.
// The visitor must not return a value — visit treats numbers as index moves.
const collectAlertQuoteFlags = (markdown: string): boolean[] => {
  const flags: boolean[] = []
  const tree = unified().use(remarkParse).parse(markdown)
  visit(tree, 'blockquote', (node) => {
    flags.push(isAlertQuoteNode(node))
  })
  return flags
}

// Drop the marker from the paragraph's rich text segments; marker may share a segment
// with the body or occupy its own (e.g. marker-only paragraph).
const stripAlertMarker = (segments: any[], markerLength: number): any[] => {
  const [first, ...rest] = segments
  const remainder = first.text.content.slice(markerLength).replace(/^\n/, '')
  if (remainder) {
    return [{ ...first, text: { ...first.text, content: remainder } }, ...rest]
  }
  return rest.length > 0 ? [stripLeadingNewline(rest[0]), ...rest.slice(1)] : []
}

const quoteToCallout = (block: any, isAlert: boolean): any => {
  if (!isAlert) {
    return block
  }
  const firstChild = block.quote?.children?.[0]
  if (firstChild?.type !== 'paragraph') {
    return block
  }
  const segments = firstChild.paragraph.rich_text ?? []
  const match = ALERT_MARKER_RE.exec(segments[0]?.text?.content ?? '')
  if (!match) {
    return block
  }
  const style = ALERT_CALLOUT_MAP[match[1].toUpperCase()] ?? UNKNOWN_ALERT_CALLOUT
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: stripAlertMarker(segments, match[0].length),
      icon: { type: 'emoji', emoji: style.emoji },
      color: style.color,
      children: block.quote.children.slice(1)
    }
  }
}

// Rewrite GitHub-style alert quotes ("> [!TYPE]") in martian output into native
// Notion callout blocks; plain quotes are left untouched.
export const rewriteAlertQuotesToCallouts = (blocks: any[], markdown: string): any[] => {
  const alertFlags = collectAlertQuoteFlags(markdown)
  let quoteIndex = 0
  const rewriteBlock = (block: any): any => {
    if (!block?.type) {
      return block
    }
    // Consume the flag before recursing so nested quotes align with the
    // source AST's document order (parents before children).
    const rewritten = block.type === 'quote' ? quoteToCallout(block, alertFlags[quoteIndex++] === true) : block
    const payload = rewritten[rewritten.type]
    return Array.isArray(payload?.children)
      ? { ...rewritten, [rewritten.type]: { ...payload, children: payload.children.map(rewriteBlock) } }
      : rewritten
  }
  return blocks.map(rewriteBlock)
}

const convertMarkdownToNotionBlocks = async (markdown: string): Promise<any[]> => {
  const { markdownToBlocks } = await loadNotionDependencies()
  return rewriteAlertQuotesToCallouts(markdownToBlocks(markdown), markdown)
}

const convertThinkingToNotionBlocks = async (thinkingContent: string): Promise<any[]> => {
  if (!thinkingContent.trim()) {
    return []
  }

  try {
    const { markdownToBlocks } = await loadNotionDependencies()
    // 预处理思维链内容：将HTML的<br>标签转换为真正的换行符
    const processedContent = thinkingContent.replace(/<br\s*\/?>/g, '\n')

    // 使用 markdownToBlocks 处理思维链内容
    const childrenBlocks = rewriteAlertQuotesToCallouts(markdownToBlocks(processedContent), processedContent)

    return [
      {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: '🤔 ' + i18n.t('common.reasoning_content')
              },
              annotations: {
                bold: true
              }
            }
          ],
          children: childrenBlocks
        }
      }
    ]
  } catch (error) {
    logger.error('failed to process reasoning content:', error as Error)
    // 发生错误时，回退到简单的段落处理
    return [
      {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: '🤔 ' + i18n.t('common.reasoning_content')
              },
              annotations: {
                bold: true
              }
            }
          ],
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content:
                        thinkingContent.length > 1800
                          ? thinkingContent.substring(0, 1800) + '...\n' + i18n.t('export.notion.reasoning_truncated')
                          : thinkingContent
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}

// Reasoning content comes from the message itself, not from the body markdown,
// so callers can produce these blocks concurrently with the body conversion.
const convertThinkingBlocksFor = async (message: ExportableMessage, reasoningEnabled: boolean): Promise<any[]> => {
  if (!reasoningEnabled) {
    return []
  }
  const thinkingContent = stripCitationMarkers(getThinkingContent(message))
  if (!thinkingContent) {
    return []
  }
  return convertThinkingToNotionBlocks(thinkingContent)
}

const executeNotionExport = async (title: string, allBlocks: any[]): Promise<boolean> => {
  if (getExportState()) {
    toast.warning(i18n.t('message.warn.export.exporting'))
    return false
  }

  const { notionDatabaseID, notionApiKey, notionPageNameKey } = await preferenceService.getMultiple({
    notionDatabaseID: 'data.integration.notion.database_id',
    notionPageNameKey: 'data.integration.notion.page_name_key',
    notionApiKey: 'data.integration.notion.api_key'
  })
  if (!notionApiKey || !notionDatabaseID) {
    toast.error(i18n.t('message.error.notion.no_api_key'))
    return false
  }

  if (allBlocks.length === 0) {
    toast.error(i18n.t('message.error.notion.export'))
    return false
  }

  setExportingState(true)

  // 限制标题长度
  if (title.length > 32) {
    title = title.slice(0, 29) + '...'
  }

  try {
    const { Client, appendBlocks } = await loadNotionDependencies()
    const notion = new Client({ auth: notionApiKey })

    const responsePromise = notion.pages.create({
      parent: { database_id: notionDatabaseID },
      properties: {
        [notionPageNameKey || 'Name']: {
          title: [{ text: { content: title } }]
        }
      }
    })
    toast.loading({ title: i18n.t('message.loading.notion.preparing'), promise: responsePromise })
    const response = await responsePromise

    const exportPromise = appendBlocks({
      block_id: response.id,
      children: allBlocks,
      client: notion
    })
    toast.loading({ title: i18n.t('message.loading.notion.exporting_progress'), promise: exportPromise })

    toast.success(i18n.t('message.success.notion.export'))
    return true
  } catch (error: any) {
    // 清理可能存在的loading消息

    logger.error('Notion export failed:', error)
    toast.error(i18n.t('message.error.notion.export'))
    return false
  } finally {
    setExportingState(false)
  }
}

export const exportMessageToNotion = async (
  title: string,
  content: string,
  message?: ExportableMessage
): Promise<boolean> =>
  runNotionExport(async () => {
    const notionExportReasoning = await preferenceService.get('data.integration.notion.export_reasoning')

    const notionBlocks = await convertMarkdownToNotionBlocks(content)

    if (notionExportReasoning && message) {
      // Same reason as `createBaseMarkdown`: the body arrives already resolved, so the trace is the
      // only way an internal marker could still reach Notion.
      const thinkingContent = stripCitationMarkers(getThinkingContent(message))
      if (thinkingContent) {
        const thinkingBlocks = await convertThinkingToNotionBlocks(thinkingContent)
        if (notionBlocks.length > 0) {
          notionBlocks.splice(1, 0, ...thinkingBlocks)
        } else {
          notionBlocks.push(...thinkingBlocks)
        }
      }
    }

    return executeNotionExport(title, notionBlocks)
  })

export const exportMessagesToNotion = async (title: string, messages: ExportableMessage[]): Promise<boolean> =>
  runNotionExport(async () => {
    const { notionExportReasoning, excludeCitationsInExport } = await preferenceService.getMultiple({
      notionExportReasoning: 'data.integration.notion.export_reasoning',
      excludeCitationsInExport: 'data.export.markdown.exclude_citations'
    })

    const titleBlocks = await convertMarkdownToNotionBlocks(`# ${title}`)

    // Body and reasoning conversions take independent inputs, so they run
    // concurrently per message and across messages; map+Promise.all keeps input order.
    const convertMessage = async (message: ExportableMessage): Promise<any[]> => {
      const [messageBlocks, thinkingBlocks] = await Promise.all([
        messageToMarkdown(message, excludeCitationsInExport).then(convertMarkdownToNotionBlocks),
        convertThinkingBlocksFor(message, notionExportReasoning)
      ])
      if (thinkingBlocks.length > 0) {
        if (messageBlocks.length > 0) {
          messageBlocks.splice(1, 0, ...thinkingBlocks)
        } else {
          messageBlocks.push(...thinkingBlocks)
        }
      }
      return messageBlocks
    }

    const messageBlocksList = await Promise.all(messages.map(convertMessage))
    const allBlocks: any[] = [...titleBlocks, ...messageBlocksList.flat()]

    return executeNotionExport(title, allBlocks)
  })

export const exportTopicToNotion = async (topic: Topic): Promise<boolean> => {
  const topicMessages = await getTopicMessages(topic.id)

  return exportMessagesToNotion(topic.name, topicMessages)
}

export const exportMarkdownToYuque = async (title: string, content: string): Promise<any | null> => {
  const { yuqueToken, yuqueRepoId } = await preferenceService.getMultiple({
    yuqueToken: 'data.integration.yuque.token',
    yuqueRepoId: 'data.integration.yuque.repo_id'
  })

  if (getExportState()) {
    toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  if (!yuqueToken || !yuqueRepoId) {
    toast.error(i18n.t('message.error.yuque.no_config'))
    return
  }

  setExportingState(true)

  try {
    const response = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueRepoId}/docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': yuqueToken,
        'User-Agent': 'CherryAI'
      },
      body: JSON.stringify({
        title: title,
        slug: Date.now().toString(), // 使用时间戳作为唯一slug
        format: 'markdown',
        body: content
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    const doc_id = data.data.id

    const tocResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueRepoId}/toc`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': yuqueToken,
        'User-Agent': 'CherryAI'
      },
      body: JSON.stringify({
        action: 'appendNode',
        action_mode: 'sibling',
        doc_ids: [doc_id]
      })
    })

    if (!tocResponse.ok) {
      throw new Error(`HTTP error! status: ${tocResponse.status}`)
    }

    toast.success(i18n.t('message.success.yuque.export'))
    return data
  } catch (error: any) {
    logger.debug(error)
    toast.error(i18n.t('message.error.yuque.export'))
    return null
  } finally {
    setExportingState(false)
  }
}

/**
 * 导出Markdown到Obsidian
 * @param attributes 文档属性
 * @param attributes.title 标题
 * @param attributes.created 创建时间
 * @param attributes.source 来源
 * @param attributes.tags 标签
 * @param attributes.processingMethod 处理方式
 * @param attributes.folder 选择的文件夹路径或文件路径
 * @param attributes.vault 选择的Vault名称
 */
export const exportMarkdownToObsidian = async (attributes: any): Promise<boolean> => {
  if (getExportState()) {
    toast.warning(i18n.t('message.warn.export.exporting'))
    return false
  }

  setExportingState(true)

  try {
    // 从参数获取Vault名称
    const obsidianVault = attributes.vault
    let obsidianFolder = attributes.folder || ''
    let isMarkdownFile = false

    if (!obsidianVault) {
      toast.error(i18n.t('chat.topics.export.obsidian_no_vault_selected'))
      return false
    }

    if (!attributes.title) {
      toast.error(i18n.t('chat.topics.export.obsidian_title_required'))
      return false
    }

    // 检查是否选择了.md文件
    if (obsidianFolder && obsidianFolder.endsWith('.md')) {
      isMarkdownFile = true
    }

    let filePath = ''

    // 如果是.md文件，直接使用该文件路径
    if (isMarkdownFile) {
      filePath = obsidianFolder
    } else {
      // 否则构建路径
      //构建保存路径添加以 / 结尾
      if (obsidianFolder && !obsidianFolder.endsWith('/')) {
        obsidianFolder = obsidianFolder + '/'
      }

      //构建文件名
      const fileName = transformObsidianFileName(attributes.title)
      filePath = obsidianFolder + fileName + '.md'
    }

    let obsidianUrl = `obsidian://new?file=${encodeURIComponent(filePath)}&vault=${encodeURIComponent(obsidianVault)}&clipboard`

    if (attributes.processingMethod === '3') {
      obsidianUrl += '&overwrite=true'
    } else if (attributes.processingMethod === '2') {
      obsidianUrl += '&prepend=true'
    } else if (attributes.processingMethod === '1') {
      obsidianUrl += '&append=true'
    }

    window.open(obsidianUrl)
    toast.success(i18n.t('chat.topics.export.obsidian_export_success'))
    return true
  } catch (error) {
    logger.error('Failed to export to Obsidian:', error as Error)
    toast.error(i18n.t('chat.topics.export.obsidian_export_failed'))
    return false
  } finally {
    setExportingState(false)
  }
}

/**
 * 生成Obsidian文件名,源自 Obsidian  Web Clipper 官方实现,修改了一些细节
 * @param fileName
 * @returns
 */
function transformObsidianFileName(fileName: string): string {
  const platform = window.navigator.userAgent
  const isWin = /win/i.test(platform)
  const isMac = /mac/i.test(platform)

  // 删除Obsidian 全平台无效字符
  let sanitized = fileName.replace(/[#|\\^\\[\]]/g, '')

  if (isWin) {
    // Windows 的清理
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '_$1$2') // 避免保留名称
      .replace(/[\s.]+$/, '') // 移除结尾的空格和句点
  } else if (isMac) {
    // Mac 的清理
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^\./, '_') // 避免以句点开头
  } else {
    // Linux 或其他系统
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^\./, '_') // 避免以句点开头
  }

  // 所有平台的通用操作
  sanitized = sanitized
    .replace(/^\.+/, '') // 移除开头的句点
    .trim() // 移除前后空格
    .slice(0, 245) // 截断为 245 个字符，留出空间以追加 ' 1.md'

  // 确保文件名不为空
  if (sanitized.length === 0) {
    sanitized = 'Untitled'
  }

  return sanitized
}

export const exportMarkdownToJoplin = async (
  title: string,
  contentOrMessages: string | ExportableMessage | ExportableMessage[]
): Promise<any | null> => {
  const { joplinUrl, joplinToken, joplinExportReasoning, excludeCitationsInExport } =
    await preferenceService.getMultiple({
      joplinUrl: 'data.integration.joplin.url',
      joplinToken: 'data.integration.joplin.token',
      joplinExportReasoning: 'data.integration.joplin.export_reasoning',
      excludeCitationsInExport: 'data.export.markdown.exclude_citations'
    })

  if (getExportState()) {
    toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  if (!joplinUrl || !joplinToken) {
    toast.error(i18n.t('message.error.joplin.no_config'))
    return
  }

  setExportingState(true)

  let content: string
  if (typeof contentOrMessages === 'string') {
    content = contentOrMessages
  } else if (Array.isArray(contentOrMessages)) {
    content = await messagesToMarkdown(contentOrMessages, joplinExportReasoning, excludeCitationsInExport)
  } else {
    // 单条Message
    content = joplinExportReasoning
      ? await messageToMarkdownWithReasoning(contentOrMessages, excludeCitationsInExport)
      : await messageToMarkdown(contentOrMessages, excludeCitationsInExport)
  }

  try {
    const baseUrl = joplinUrl.endsWith('/') ? joplinUrl : `${joplinUrl}/`
    const response = await fetch(`${baseUrl}notes?token=${joplinToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: title,
        body: content,
        source: 'Cherry Studio'
      })
    })

    if (!response.ok) {
      throw new Error('service not available')
    }

    const data = await response.json()
    if (data?.error) {
      throw new Error('response error')
    }

    toast.success(i18n.t('message.success.joplin.export'))
    return data
  } catch (error: any) {
    logger.error('Failed to export to Joplin:', error)
    toast.error(i18n.t('message.error.joplin.export'))
    return null
  } finally {
    setExportingState(false)
  }
}

/**
 * 导出Markdown到思源笔记
 * @param title 笔记标题
 * @param content 笔记内容
 */
export const exportMarkdownToSiyuan = async (title: string, content: string): Promise<void> => {
  const { siyuanApiUrl, siyuanToken, siyuanBoxId, siyuanRootPath } = await preferenceService.getMultiple({
    siyuanApiUrl: 'data.integration.siyuan.api_url',
    siyuanToken: 'data.integration.siyuan.token',
    siyuanBoxId: 'data.integration.siyuan.box_id',
    siyuanRootPath: 'data.integration.siyuan.root_path'
  })

  if (getExportState()) {
    toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  if (!siyuanApiUrl || !siyuanToken || !siyuanBoxId) {
    toast.error(i18n.t('message.error.siyuan.no_config'))
    return
  }

  setExportingState(true)

  try {
    // test connection
    const testResponse = await fetch(`${siyuanApiUrl}/api/notebook/lsNotebooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${siyuanToken}`
      }
    })

    if (!testResponse.ok) {
      throw new Error('API请求失败')
    }

    const testData = await testResponse.json()
    if (testData.code !== 0) {
      throw new Error(`${testData.msg || i18n.t('message.error.unknown')}`)
    }

    // 确保根路径以/开头
    const rootPath = siyuanRootPath?.startsWith('/') ? siyuanRootPath : `/${siyuanRootPath || 'CherryStudio'}`
    const renderedRootPath = await renderSprigTemplate(siyuanApiUrl, siyuanToken, rootPath)
    // 创建文档
    const docTitle = `${title.replace(/[#|\\^\\[\]]/g, '')}`
    const docPath = `${renderedRootPath}/${docTitle}`

    // 创建文档
    await createSiyuanDoc(siyuanApiUrl, siyuanToken, siyuanBoxId, docPath, content)

    toast.success(i18n.t('message.success.siyuan.export'))
  } catch (error) {
    logger.error('Failed to export to Siyuan:', error as Error)
    toast.error(i18n.t('message.error.siyuan.export') + (error instanceof Error ? `: ${error.message}` : ''))
  } finally {
    setExportingState(false)
  }
}
/**
 * 渲染 思源笔记 Sprig 模板字符串
 * @param apiUrl 思源 API 地址
 * @param token 思源 API Token
 * @param template Sprig 模板
 * @returns 渲染后的字符串
 */
async function renderSprigTemplate(apiUrl: string, token: string, template: string): Promise<string> {
  const response = await fetch(`${apiUrl}/api/template/renderSprig`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`
    },
    body: JSON.stringify({ template })
  })

  const data = await response.json()
  if (data.code !== 0) {
    throw new Error(`${data.msg || i18n.t('message.error.unknown')}`)
  }

  return data.data
}

/**
 * 创建思源笔记文档
 */
async function createSiyuanDoc(
  apiUrl: string,
  token: string,
  boxId: string,
  path: string,
  markdown: string
): Promise<string> {
  const response = await fetch(`${apiUrl}/api/filetree/createDocWithMd`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`
    },
    body: JSON.stringify({
      notebook: boxId,
      path: path,
      markdown: markdown
    })
  })

  const data = await response.json()
  if (data.code !== 0) {
    throw new Error(`${data.msg || i18n.t('message.error.unknown')}`)
  }

  return data.data
}

const saveContentToNotes = async (title: string, content: string, folderPath: string): Promise<void> => {
  await addNote(title, content, folderPath)

  toast.success(i18n.t('message.success.notes.export'))
}

const handleNotesExportError = (error: unknown): void => {
  logger.error('导出到笔记失败:', error as Error)
  toast.error(i18n.t('message.error.notes.export'))
}

/**
 * 导出任意文本内容到笔记工作区
 * @param title 笔记标题
 * @param content 笔记内容
 * @param folderPath 目标笔记文件夹
 */
export const exportContentToNotes = async (title: string, content: string, folderPath: string): Promise<void> => {
  try {
    await saveContentToNotes(title, content, folderPath)
  } catch (error) {
    handleNotesExportError(error)
    throw error
  }
}

/**
 * 导出消息到笔记工作区
 * @param title
 * @param content
 * @param folderPath
 */
export const exportMessageToNotes = async (title: string, content: string, folderPath: string): Promise<void> => {
  const cleanedContent = content.replace(/^## 🤖 Assistant(\n|$)/m, '')
  await exportContentToNotes(title, cleanedContent, folderPath)
}

/**
 * 导出话题到笔记工作区
 * @param topic 要导出的话题
 * @param folderPath
 */
export const exportTopicToNotes = async (topic: Topic, folderPath: string): Promise<void> => {
  try {
    const content = await topicToMarkdown(topic)
    await saveContentToNotes(topic.name, content, folderPath)
  } catch (error) {
    handleNotesExportError(error)
    throw error
  }
}

// NOTE (domain-axis follow-up, deferred per the cycle-break refactor plan):
// the note-export helpers from here down (`exportNoteAsMarkdown`, the
// `getScrollable*` accessors, the image-capture helpers, and the `exportNote`
// dispatcher) are notes-domain-specific — `getScrollableElement` even reaches
// into the `#notes-page` DOM of the notes page. They sit in this shared,
// cross-domain service only because notes has no `features/notes/` home yet;
// once it earns one, this cluster should move into the notes feature. Out of
// scope for breaking the MessagesService <-> utils/export cycle.
const exportNoteAsMarkdown = async (noteName: string, content: string): Promise<void> => {
  const markdown = `# ${noteName}\n\n${content}`
  const fileName = removeSpecialCharactersForFileName(noteName) + '.md'
  const result = await window.api.file.save(fileName, markdown)
  if (result) {
    toast.success(i18n.t('message.success.markdown.export.specified'))
  }
}

const getScrollableElement = (): HTMLElement | null => {
  const notesPage = document.querySelector('#notes-page')
  if (!notesPage) return null

  const allDivs = notesPage.querySelectorAll('div')
  for (const div of Array.from(allDivs)) {
    const style = window.getComputedStyle(div)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      if (div.querySelector('.ProseMirror')) {
        return div as HTMLElement
      }
    }
  }
  return null
}

const getScrollableRef = (): { current: HTMLElement } | null => {
  const element = getScrollableElement()
  if (!element) {
    toast.warning(i18n.t('notes.no_content_to_copy'))
    return null
  }
  return { current: element }
}

const exportNoteAsImageToClipboard = async (): Promise<void> => {
  const scrollableRef = getScrollableRef()
  if (!scrollableRef) return

  await captureScrollableAsBlob(scrollableRef, async (blob) => {
    if (blob) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast.success(i18n.t('common.copied'))
    }
  })
}

const exportNoteAsImageFile = async (noteName: string): Promise<void> => {
  const scrollableRef = getScrollableRef()
  if (!scrollableRef) return

  const dataUrl = await captureScrollableAsDataUrl(scrollableRef)
  if (dataUrl) {
    const fileName = removeSpecialCharactersForFileName(noteName)
    await window.api.file.saveImage(fileName, dataUrl)
  }
}

interface NoteExportOptions {
  node: { name: string; externalPath: string }
  platform: 'markdown' | 'docx' | 'notion' | 'yuque' | 'joplin' | 'siyuan' | 'copyImage' | 'exportImage'
}

export const exportNote = async ({ node, platform }: NoteExportOptions): Promise<void> => {
  try {
    const content = await window.api.file.readExternal(node.externalPath)

    switch (platform) {
      case 'copyImage':
        return await exportNoteAsImageToClipboard()
      case 'exportImage':
        return await exportNoteAsImageFile(node.name)
      case 'markdown':
        return await exportNoteAsMarkdown(node.name, content)
      case 'docx':
        void ipcApi.request('export.word.from_markdown', {
          markdown: `# ${node.name}\n\n${content}`,
          fileName: removeSpecialCharactersForFileName(node.name)
        })
        return
      case 'notion':
        await exportMessageToNotion(node.name, content)
        return
      case 'yuque':
        await exportMarkdownToYuque(node.name, `# ${node.name}\n\n${content}`)
        return
      case 'joplin':
        await exportMarkdownToJoplin(node.name, content)
        return
      case 'siyuan':
        await exportMarkdownToSiyuan(node.name, `# ${node.name}\n\n${content}`)
        return
    }
  } catch (error) {
    logger.error(`Failed to export note to ${platform}:`, error as Error)
    throw error
  }
}
