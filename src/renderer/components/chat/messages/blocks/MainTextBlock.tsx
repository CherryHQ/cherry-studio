import { Flex, type MarkdownSource } from '@cherrystudio/ui'
import type { ChatInputTokenKind } from '@renderer/components/chat/tokens'
import { ComposerToken } from '@renderer/components/chat/tokens'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import type { Citation, Model } from '@renderer/types'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import { getDisplayComposerTokens } from '@renderer/utils/messageUtils/composerTokens'
import type { CitationReferenceView } from '@renderer/utils/partsToBlocks'
import type { CherryUIMessage } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import type { ComposerMessageSnapshot, ComposerMessageToken } from '@shared/data/types/uiParts'
import { ChevronDown, Code2, Globe2 } from 'lucide-react'
import React, { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'

import ChatMarkdown from '../markdown/ChatMarkdown'
import { useMessageRenderConfig } from '../MessageListProvider'
import CitationsList from './CitationsList'

interface Props {
  id: string
  content: string
  isStreaming: boolean
  citations?: Citation[]
  citationReferences?: CitationReferenceView[]
  mentions?: Model[]
  role: CherryUIMessage['role']
  composer?: ComposerMessageSnapshot
}

const composerTokenIcon: Partial<
  Record<ComposerMessageToken['kind'], React.ComponentType<{ size?: number; className?: string }>>
> = {
  command: Code2,
  reference: Globe2
}

type ComposerTokenBackedMessageToken = ComposerMessageToken & { kind: ChatInputTokenKind }

const COMPOSER_TOKEN_BACKED_KINDS = new Set<ComposerMessageToken['kind']>(['file', 'knowledge', 'quote', 'skill'])

const COMPOSER_TOKEN_MARKDOWN_ATTR = 'data-composer-token-index'
const COMPOSER_TOKEN_MARKDOWN_BLOCK_ATTR = 'data-composer-token-block'
const USER_MESSAGE_PREVIEW_EFFECTIVE_LINE_COUNT = 5

function isComposerTokenBackedMessageToken(token: ComposerMessageToken): token is ComposerTokenBackedMessageToken {
  return COMPOSER_TOKEN_BACKED_KINDS.has(token.kind)
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

function ComposerMessageTokenChip({ token }: { token: ComposerMessageToken }) {
  if (isComposerTokenBackedMessageToken(token)) {
    return <ComposerToken token={token} />
  }

  return <LegacyComposerMessageTokenChip token={token} />
}

function renderComposerMessageContent(content: string, composer: ComposerMessageSnapshot) {
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

    nodes.push(<ComposerMessageTokenChip key={`${token.id}:${token.index}`} token={token} />)

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

function buildUserMessagePreview(content: string) {
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

  return (
    <div className="flex max-w-full flex-col items-start">
      <div
        id={contentId}
        data-user-message-collapsible-content-preview
        className="max-w-full [&>*:last-child]:mb-0! [&_.markdown>*:last-child]:mb-0!">
        {children}
      </div>
      {isCollapsible && (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="mt-1 flex min-h-7 w-full items-center justify-start gap-1.5 rounded border-0 bg-transparent px-0 py-0.5 text-left text-[13px] text-foreground-secondary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          onClick={onToggle}>
          <span className="shrink-0 font-normal leading-5">
            {t(isExpanded ? 'message.message.user_content.collapse' : 'message.message.user_content.expand')}
          </span>
          <ChevronDown
            aria-hidden="true"
            size={16}
            className={`shrink-0 text-foreground-muted opacity-70 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    </div>
  )
}

const MainTextBlock: React.FC<Props> = ({
  id,
  content,
  isStreaming,
  citations = [],
  citationReferences,
  role,
  mentions = [],
  composer
}) => {
  const { renderInputMessageAsMarkdown } = useMessageRenderConfig()
  const shouldRenderComposerTokens = role === 'user' && !!composer?.tokens.length
  const userMessagePreview = useMemo(() => buildUserMessagePreview(content), [content])
  const isUserContentCollapsible = role === 'user' && userMessagePreview.isTruncated
  const [isUserContentExpanded, setIsUserContentExpanded] = useState(false)

  useEffect(() => {
    if (!isUserContentCollapsible) {
      setIsUserContentExpanded(false)
    }
  }, [isUserContentCollapsible])

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

  const block: MarkdownSource = {
    id,
    content: role === 'user' ? userDisplayContent : smoothedContent,
    status: isStreaming ? 'streaming' : 'success'
  }

  const processContent = useCallback(
    (rawText: string) => {
      if (!citationReferences?.length || citations.length === 0) return rawText
      const sourceType = determineCitationSource(citationReferences)
      return withCitationTags(rawText, citations, sourceType)
    },
    [citationReferences, citations]
  )
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
        if (token) return <ComposerMessageTokenChip token={token} />

        return <span {...props}>{children}</span>
      }
    }),
    [composerMarkdownContent?.tokens, id]
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
          onToggle={() => setIsUserContentExpanded((expanded) => !expanded)}>
          {composerMarkdownContent ? (
            <ChatMarkdown
              block={{ ...block, content: composerMarkdownContent.markdown }}
              components={composerMarkdownComponents}
              postProcess={processContent}
            />
          ) : shouldRenderComposerTokens || !renderInputMessageAsMarkdown ? (
            <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
              {shouldRenderComposerTokens
                ? renderComposerMessageContent(userDisplayContent, composer)
                : userDisplayContent}
            </p>
          ) : (
            <ChatMarkdown block={block} postProcess={processContent} />
          )}
        </CollapsibleUserMessageContent>
      ) : (
        <ChatMarkdown block={block} postProcess={processContent} />
      )}
      {/* Parts data stores citation refs per text part, so the list is scoped to the text segment that produced it. */}
      {citations.length > 0 && <CitationsList citations={citations} />}
    </>
  )
}

export default React.memo(MainTextBlock)
