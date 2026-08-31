import { Flex, type MarkdownSource } from '@cherrystudio/ui'
import type { ChatInputTokenKind } from '@renderer/components/composer/chatTokenView'
import { ComposerToken, type ReadOnlyComposerFileTokenPreview } from '@renderer/components/composer/tokenView'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import type { Citation } from '@renderer/types/message'
import type { Model } from '@renderer/types/model'
import { determineCitationSource, toTooltipCitation, withCitationTags } from '@renderer/utils/citation'
import { isComposerInputTokenKind } from '@renderer/utils/composerTokenPolicy'
import {
  type MessageCitations,
  type ResolvedCitationMarkers,
  stripCitationMarkers,
  withToolCitationTags
} from '@renderer/utils/message/citations'
import { readComposerFileTokenIdSuffix } from '@renderer/utils/message/composerFileTokenSource'
import { getDisplayComposerTokens } from '@renderer/utils/message/composerTokens'
import type { CitationReferenceView } from '@renderer/utils/partsToBlocks'
import type { CherryUIMessage } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import type { ComposerMessageSnapshot, ComposerMessageToken } from '@shared/data/types/uiParts'
import { ChevronDown, Code2 } from 'lucide-react'
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'

import ChatMarkdown, { type InlineHtmlPreviewMode } from '../markdown/ChatMarkdown'
import { useMessageRenderConfig } from '../MessageListProvider'
import CitationsList from './CitationsList'
import { useScrollAnchor } from './useScrollAnchor'

interface Props {
  id: string
  content: string
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  isStreaming: boolean
  citations?: Citation[]
  citationReferences?: CitationReferenceView[]
  /** Tool/source-derived citations resolved from the message's own parts (assistant messages without legacy reference metadata). */
  messageCitations?: MessageCitations
  toolCitationProjection?: ResolvedCitationMarkers
  mentions?: Model[]
  role: CherryUIMessage['role']
  composer?: ComposerMessageSnapshot
  readOnlyFilePreviews?: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
  userContentExpanded?: boolean
  onPlayoutSettledChange?: (partId: string, settled: boolean) => void
  onUserContentExpandedChange?: (expanded: boolean) => void
}

const composerTokenIcon: Partial<
  Record<ComposerMessageToken['kind'], React.ComponentType<{ size?: number; className?: string }>>
> = {
  command: Code2
}

type ComposerTokenBackedMessageToken = ComposerMessageToken & { kind: ChatInputTokenKind }

const COMPOSER_TOKEN_MARKDOWN_ATTR = 'data-composer-token-index'
const COMPOSER_TOKEN_MARKDOWN_BLOCK_ATTR = 'data-composer-token-block'
const USER_MESSAGE_PREVIEW_EFFECTIVE_LINE_COUNT = 5
// A fresh empty array per render would cascade through trustedCitations into
// ChatMarkdown's components map and force Streamdown to re-render (and
// re-animate) every markdown block on each streaming tick.
const EMPTY_CITATIONS: Citation[] = []

function isComposerTokenBackedMessageToken(token: ComposerMessageToken): token is ComposerTokenBackedMessageToken {
  return isComposerInputTokenKind(token.kind)
}

function LegacyComposerMessageTokenChip({ token }: { token: ComposerMessageToken }) {
  const Icon = composerTokenIcon[token.kind]
  if (!Icon) return null
  const title = token.description ?? token.label

  return (
    <span
      className="mx-0.5 inline-flex max-w-52 select-none items-baseline gap-1 overflow-hidden align-baseline text-primary leading-[inherit]"
      data-composer-token-kind={token.kind}
      title={title}>
      <Icon className="size-[1em] shrink-0 translate-y-[0.08em] text-current opacity-80" />
      <span className="whitespace-nowrap! min-w-0 truncate break-normal">{token.label}</span>
    </span>
  )
}

function ComposerMessageTokenChip({
  token,
  readOnlyFilePreviews
}: {
  token: ComposerMessageToken
  readOnlyFilePreviews?: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
}) {
  if (isComposerTokenBackedMessageToken(token)) {
    const fileTokenSourceId = token.kind === 'file' ? readComposerFileTokenIdSuffix(token.id) : undefined
    const readOnlyFilePreview = fileTokenSourceId ? readOnlyFilePreviews?.get(fileTokenSourceId) : undefined

    return <ComposerToken token={token} readOnly readOnlyFilePreview={readOnlyFilePreview} />
  }

  return <LegacyComposerMessageTokenChip token={token} />
}

function renderComposerMessageContent(
  content: string,
  composer: ComposerMessageSnapshot,
  readOnlyFilePreviews?: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
) {
  const tokens = getDisplayComposerTokens(composer)
  const nodes: React.ReactNode[] = []
  let cursor = 0

  tokens.forEach((token) => {
    const offset = Math.max(0, Math.min(content.length, token.textOffset))
    const promptText = token.promptText
    const promptTextMatches = !!promptText && content.slice(offset, offset + promptText.length) === promptText
    if (promptText && !promptTextMatches) return

    if (offset > cursor) {
      nodes.push(content.slice(cursor, offset))
      cursor = offset
    }

    nodes.push(
      <ComposerMessageTokenChip
        key={`${token.id}:${token.index}`}
        token={token}
        readOnlyFilePreviews={readOnlyFilePreviews}
      />
    )

    if (promptTextMatches) {
      cursor = Math.max(cursor, offset + promptText.length)
    }
  })

  if (cursor < content.length) {
    nodes.push(content.slice(cursor))
  }

  return nodes
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getComposerMarkdownTokenPlaceholder(index: number, blockId: string) {
  return `<span ${COMPOSER_TOKEN_MARKDOWN_ATTR}="${index}" ${COMPOSER_TOKEN_MARKDOWN_BLOCK_ATTR}="${escapeHtmlAttribute(blockId)}"></span>`
}

function buildComposerMessageMarkdownContent(content: string, composer: ComposerMessageSnapshot, blockId: string) {
  const tokens = getDisplayComposerTokens(composer)
  let markdown = ''
  let cursor = 0

  tokens.forEach((token, index) => {
    const offset = Math.max(0, Math.min(content.length, token.textOffset))
    const promptText = token.promptText
    const promptTextMatches = !!promptText && content.slice(offset, offset + promptText.length) === promptText
    if (promptText && !promptTextMatches) return

    if (offset > cursor) {
      markdown += content.slice(cursor, offset)
      cursor = offset
    }

    markdown += getComposerMarkdownTokenPlaceholder(index, blockId)

    if (promptTextMatches) {
      cursor = Math.max(cursor, offset + promptText.length)
    }
  })

  if (cursor < content.length) {
    markdown += content.slice(cursor)
  }

  return { markdown, tokens }
}

function buildUserMessageTextPreview(content: string) {
  let effectiveLineCount = 0
  const lineRegex = /([^\r\n]*)(\r\n|\r|\n|$)/g

  for (const match of content.matchAll(lineRegex)) {
    const [lineWithEnding, line] = match
    if (lineWithEnding.length === 0) break
    if (line.trim().length === 0) continue

    effectiveLineCount += 1

    if (effectiveLineCount === USER_MESSAGE_PREVIEW_EFFECTIVE_LINE_COUNT) {
      const remainingStart = match.index + lineWithEnding.length
      const hasMoreEffectiveLines = content
        .slice(remainingStart)
        .split(/\r\n|\r|\n/)
        .some((remainingLine) => remainingLine.trim().length > 0)

      return {
        content: hasMoreEffectiveLines ? content.slice(0, match.index + line.length) : content,
        isTruncated: hasMoreEffectiveLines
      }
    }
  }

  return {
    content,
    isTruncated: false
  }
}

function buildComposerTokenPreviewProjection(content: string, composer: ComposerMessageSnapshot) {
  let projectedContent = ''
  const rawOffsets = [0]
  let cursor = 0

  const appendText = (text: string, rawStart: number) => {
    projectedContent += text
    for (let index = 1; index <= text.length; index += 1) {
      rawOffsets.push(rawStart + index)
    }
  }

  getDisplayComposerTokens(composer).forEach((token) => {
    const offset = Math.max(0, Math.min(content.length, token.textOffset))
    const promptText = token.promptText
    const promptTextMatches = !!promptText && content.slice(offset, offset + promptText.length) === promptText
    if (promptText && !promptTextMatches) return

    if (offset > cursor) {
      appendText(content.slice(cursor, offset), cursor)
      cursor = offset
    }

    // Count a rendered token chip as one visible character. Mapping its end
    // back to the raw prompt boundary keeps collapsed previews from slicing
    // through hidden composer context and exposing it as plain text.
    projectedContent += '\uFFFC'
    if (promptTextMatches) {
      cursor = Math.max(cursor, offset + promptText.length)
    }
    rawOffsets.push(cursor)
  })

  if (cursor < content.length) {
    appendText(content.slice(cursor), cursor)
  }

  return { content: projectedContent, rawOffsets }
}

export function buildUserMessagePreview(content: string, composer?: ComposerMessageSnapshot) {
  if (!composer) return buildUserMessageTextPreview(content)

  const projection = buildComposerTokenPreviewProjection(content, composer)
  const preview = buildUserMessageTextPreview(projection.content)
  if (!preview.isTruncated) return { content, isTruncated: false }

  const rawEnd = projection.rawOffsets[preview.content.length] ?? content.length
  return { content: content.slice(0, rawEnd), isTruncated: true }
}

function CollapsibleUserMessageContent({
  children,
  isCollapsible,
  isExpanded,
  onToggle
}: {
  children: React.ReactNode
  isCollapsible: boolean
  isExpanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const contentId = useId()
  // Keep the message's top stable when expand/collapse changes its height, so a
  // toggle on a message above the fold doesn't jump the content the user is
  // reading — matching ThinkingBlock / CompactBlock.
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()

  return (
    <div ref={anchorRef} className="flex max-w-full flex-col items-start">
      <div
        id={contentId}
        data-user-message-collapsible-content-preview
        className="max-w-full has-[.code-block]:w-full [&>*:last-child]:mb-0! [&_.markdown>*:last-child]:mb-0!">
        {children}
      </div>
      {isCollapsible && (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          data-user-message-content-toggle
          className="mt-1 flex min-h-7 w-full items-center justify-start gap-1.5 rounded border-0 bg-transparent px-0 py-0.5 text-left text-[13px] text-muted-foreground focus-visible:bg-accent/50 focus-visible:outline-none"
          onClick={() => withScrollAnchor(onToggle, { enterReadingMode: !isExpanded })}>
          <span className="shrink-0 font-normal leading-5">
            {t(isExpanded ? 'message.message.user_content.collapse' : 'message.message.user_content.expand')}
          </span>
          <ChevronDown
            aria-hidden="true"
            size={16}
            className={`shrink-0 text-foreground-tertiary opacity-70 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    </div>
  )
}

const MainTextBlock: React.FC<Props> = ({
  id,
  content,
  inlineHtmlPreviewMode,
  isStreaming,
  citations = EMPTY_CITATIONS,
  citationReferences,
  messageCitations,
  toolCitationProjection,
  role,
  mentions = [],
  composer,
  readOnlyFilePreviews,
  userContentExpanded,
  onPlayoutSettledChange,
  onUserContentExpandedChange
}) => {
  const { renderInputMessageAsMarkdown } = useMessageRenderConfig()
  const shouldRenderComposerTokens = role === 'user' && !!composer?.tokens.length
  const userMessagePreview = useMemo(() => buildUserMessagePreview(content, composer), [composer, content])
  const isUserContentCollapsible = role === 'user' && userMessagePreview.isTruncated
  const [internalUserContentExpanded, setInternalUserContentExpanded] = useState(false)
  const isUserContentExpanded = userContentExpanded ?? internalUserContentExpanded
  const setUserContentExpanded = useCallback(
    (expanded: boolean | ((current: boolean) => boolean)) => {
      const nextExpanded = typeof expanded === 'function' ? expanded(isUserContentExpanded) : expanded
      if (userContentExpanded === undefined) {
        setInternalUserContentExpanded(nextExpanded)
      }
      onUserContentExpandedChange?.(nextExpanded)
    },
    [isUserContentExpanded, onUserContentExpandedChange, userContentExpanded]
  )

  useEffect(() => {
    if (!isUserContentCollapsible) {
      setUserContentExpanded(false)
    }
  }, [isUserContentCollapsible, setUserContentExpanded])

  const userDisplayContent = isUserContentCollapsible && !isUserContentExpanded ? userMessagePreview.content : content

  const [smoothedContent, setSmoothedContent] = useState(content)
  const { update: updateSmoothStream } = useSmoothStream({
    onUpdate: setSmoothedContent,
    streamDone: !isStreaming,
    initialText: content
  })
  useEffect(() => {
    updateSmoothStream(content, !isStreaming)
  }, [content, isStreaming, updateSmoothStream])

  const isPlayoutSettled = !isStreaming && smoothedContent === content
  useEffect(() => {
    onPlayoutSettledChange?.(id, isPlayoutSettled)
  }, [id, isPlayoutSettled, onPlayoutSettledChange])
  useEffect(
    () => () => {
      onPlayoutSettledChange?.(id, true)
    },
    [id, onPlayoutSettledChange]
  )

  const block: MarkdownSource = {
    id,
    content: role === 'user' ? userDisplayContent : smoothedContent,
    status: isStreaming ? 'streaming' : 'success'
  }
  // Upstream completion can precede the smooth-stream tail. Keep the iframe unmounted
  // until its first srcDoc contains the complete artifact.
  const resolvedInlineHtmlPreviewMode =
    inlineHtmlPreviewMode === 'ready' && smoothedContent !== content ? 'generating' : inlineHtmlPreviewMode

  // Legacy reference metadata (migrated v1 messages) wins; otherwise resolve
  // [cite:id] markers against the message's own tool/source parts.
  const toolCitations = useMemo(
    () =>
      citations.length === 0 && messageCitations?.all.length && toolCitationProjection
        ? { citations: messageCitations, projection: toolCitationProjection }
        : undefined,
    [citations.length, messageCitations, toolCitationProjection]
  )
  const processContent = useCallback(
    (rawText: string) => {
      if (citationReferences?.length && citations.length > 0) {
        const sourceType = determineCitationSource(citationReferences)
        return withCitationTags(rawText, citations, sourceType)
      }
      if (toolCitations) {
        return withToolCitationTags(rawText, toolCitations.citations, toolCitations.projection.byMarker).content
      }
      // No citation at all in this message, so no marker in it can resolve — a model reusing an id
      // minted by an earlier turn is the usual way here (#19771). Drop them rather than printing
      // internal ids. User text is left alone: a literal `[cite:…]` there is the author's own.
      return role === 'assistant' ? stripCitationMarkers(rawText) : rawText
    },
    [citationReferences, citations, role, toolCitations]
  )
  const toolCitedCitations = toolCitations?.projection.cited ?? EMPTY_CITATIONS
  const footerCitations = citations.length > 0 ? citations : toolCitedCitations
  const trustedCitations = useMemo(() => footerCitations.map(toTooltipCitation), [footerCitations])
  const composerMarkdownContent = useMemo(() => {
    if (!shouldRenderComposerTokens || !renderInputMessageAsMarkdown || !composer) return undefined
    return buildComposerMessageMarkdownContent(userDisplayContent, composer, id)
  }, [composer, id, renderInputMessageAsMarkdown, shouldRenderComposerTokens, userDisplayContent])
  const composerMarkdownComponents = useMemo<Partial<Components>>(
    () => ({
      span: ({ children, ...props }) => {
        const rawProps = props as Record<string, unknown>
        const rawIndex = rawProps[COMPOSER_TOKEN_MARKDOWN_ATTR] ?? rawProps.dataComposerTokenIndex
        const rawBlock = rawProps[COMPOSER_TOKEN_MARKDOWN_BLOCK_ATTR] ?? rawProps.dataComposerTokenBlock
        const tokenIndex = typeof rawIndex === 'string' ? Number.parseInt(rawIndex, 10) : NaN
        const token =
          rawBlock === id && Number.isFinite(tokenIndex) ? composerMarkdownContent?.tokens[tokenIndex] : undefined
        if (token) return <ComposerMessageTokenChip token={token} readOnlyFilePreviews={readOnlyFilePreviews} />

        return <span {...props}>{children}</span>
      }
    }),
    [composerMarkdownContent?.tokens, id, readOnlyFilePreviews]
  )

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex className="mb-2.5 flex-wrap gap-2">
          {mentions.map((m) => (
            <span key={createUniqueModelId(m.provider, m.id)} className="text-primary">
              {'@' + m.name}
            </span>
          ))}
        </Flex>
      )}
      {role === 'user' ? (
        <CollapsibleUserMessageContent
          isCollapsible={isUserContentCollapsible}
          isExpanded={isUserContentExpanded}
          onToggle={() => setUserContentExpanded((expanded) => !expanded)}>
          {composerMarkdownContent ? (
            <ChatMarkdown
              block={{ ...block, content: composerMarkdownContent.markdown }}
              components={composerMarkdownComponents}
              postProcess={processContent}
              trustedCitations={trustedCitations}
            />
          ) : shouldRenderComposerTokens || !renderInputMessageAsMarkdown ? (
            <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
              {shouldRenderComposerTokens
                ? renderComposerMessageContent(userDisplayContent, composer, readOnlyFilePreviews)
                : userDisplayContent}
            </p>
          ) : (
            <ChatMarkdown block={block} postProcess={processContent} trustedCitations={trustedCitations} />
          )}
        </CollapsibleUserMessageContent>
      ) : (
        <ChatMarkdown
          block={block}
          inlineHtmlPreviewMode={resolvedInlineHtmlPreviewMode}
          postProcess={processContent}
          trustedCitations={trustedCitations}
        />
      )}
      {/* Parts data stores citation refs per text part, so the list is scoped to the text segment that produced it. */}
      {footerCitations.length > 0 && <CitationsList citations={footerCitations} />}
    </>
  )
}

export default React.memo(MainTextBlock)
