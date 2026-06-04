import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'
import 'remark-github-blockquote-alert/alert.css'

import { usePreference } from '@data/hooks/usePreference'
import ImageViewer from '@renderer/components/ImageViewer'
import MarkdownShadowDomRenderer from '@renderer/components/MarkdownShadowDomRenderer'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import type { MessageBlockStatus } from '@renderer/types/newMessage'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets, splitMarkdownBlocks } from '@renderer/utils/markdown'
import { isEmpty } from 'lodash'
import { createContext, type FC, memo, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Components, defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
// @ts-ignore rehype-mathjax is not typed
import rehypeMathjax from 'rehype-mathjax'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkAlert from 'remark-github-blockquote-alert'
import remarkMath from 'remark-math'
import type { Pluggable, PluggableList } from 'unified'

import CodeBlock from './CodeBlock'
import Link from './Link'
import MarkdownBlock from './MarkdownBlock'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import rehypeScalableSvg from './plugins/rehypeScalableSvg'
import remarkDisableConstructs from './plugins/remarkDisableConstructs'
import Table from './Table'

const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup|details|summary)/i
const DISALLOWED_ELEMENTS = ['iframe', 'script']

/**
 * Lightweight interface for Markdown rendering source.
 * Only requires id, content, and status — no dependency on MessageBlock types.
 */
export interface MarkdownSource {
  id: string
  content: string
  status: MessageBlockStatus | string
}

/**
 * Context providing raw markdown content and streaming state to sub-components
 * (CodeBlock, Table) so they don't need useResolveBlock or Redux lookups.
 */
export interface MarkdownBlockContextValue {
  content: string
  isStreaming: boolean
}

export const MarkdownBlockContext = createContext<MarkdownBlockContextValue | null>(null)

export function useMarkdownBlockContext(): MarkdownBlockContextValue | null {
  return use(MarkdownBlockContext)
}

interface Props {
  block: MarkdownSource
  postProcess?: (text: string) => string
}

const Markdown: FC<Props> = ({ block, postProcess }) => {
  const { t } = useTranslation()
  const [mathEngine] = usePreference('chat.message.math.engine')
  const [mathEnableSingleDollar] = usePreference('chat.message.math.single_dollar')

  const remarkPlugins = useMemo(() => {
    const plugins = [
      [remarkGfm, { singleTilde: false }] as Pluggable,
      [remarkAlert] as Pluggable,
      remarkCjkFriendly,
      remarkDisableConstructs(['codeIndented'])
    ]
    if (mathEngine !== 'none') {
      plugins.push([remarkMath, { singleDollarTextMath: mathEnableSingleDollar }])
    }
    return plugins
  }, [mathEngine, mathEnableSingleDollar])

  // `block.status === 'streaming'` is set by callers when (and only when)
  // the topic-level ActiveStream is live for this message — see
  // `PartsRenderer`, which derives the streaming flag from
  // `useTopicStreamStatus` and threads it down through MainTextBlock /
  // ThinkingBlock.
  const isStreaming = block.status === 'streaming'
  const [displayedContent, setDisplayedContent] = useState(postProcess ? postProcess(block.content) : block.content)
  const [isStreamDone, setIsStreamDone] = useState(!isStreaming)
  const prevContentRef = useRef(block.content)
  const prevBlockIdRef = useRef(block.id)

  const { addChunk, reset } = useSmoothStream({
    onUpdate: (rawText) => {
      const finalText = postProcess ? postProcess(rawText) : rawText
      setDisplayedContent(finalText)
    },
    streamDone: isStreamDone,
    initialText: block.content
  })

  useEffect(() => {
    const newContent = block.content || ''
    const oldContent = prevContentRef.current || ''

    const isDifferentBlock = block.id !== prevBlockIdRef.current
    // Treat any non-extension as a reset, including content shrinking back to
    // empty (e.g. a second translation seeds `content: ''` after the previous
    // result was already displayed). Without the reset, the smooth-stream's
    // `displayedTextRef` would carry "stale + new" — chunks would visibly
    // append onto the previous translation instead of starting fresh.
    const isContentReset = oldContent.length > 0 && !newContent.startsWith(oldContent)

    if (isDifferentBlock || isContentReset) {
      reset(newContent)
    } else {
      const delta = newContent.substring(oldContent.length)
      if (delta) addChunk(delta)
    }

    prevContentRef.current = newContent
    prevBlockIdRef.current = block.id

    setIsStreamDone(!isStreaming)
  }, [block.content, block.id, isStreaming, addChunk, reset])

  const messageContent = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    return removeSvgEmptyLines(processLatexBrackets(displayedContent))
  }, [block.status, block.content, displayedContent, t])

  // Booleans, not `messageContent`, gate the plugin/component memos: their
  // values flip at most once per message (raw HTML / <style> appears once and
  // stays), so the rehype array and components map keep a STABLE identity
  // across streaming chunks. That stability is what lets the per-block
  // `React.memo` actually skip completed blocks — depending on `messageContent`
  // (which changes every chunk) would mint fresh arrays each frame and defeat
  // the whole optimization.
  const hasRawHtml = useMemo(() => ALLOWED_ELEMENTS.test(messageContent), [messageContent])
  const hasStyleTag = useMemo(() => /<style\b[^>]*>/i.test(messageContent), [messageContent])

  // Base rehype chain WITHOUT heading-ids — MarkdownBlock appends a
  // per-block-prefixed `rehypeHeadingIds` so anchor ids stay unique and
  // deterministic per block position.
  const rehypeBasePlugins = useMemo<PluggableList>(() => {
    const plugins: Pluggable[] = []
    if (hasRawHtml) {
      plugins.push(rehypeRaw, rehypeScalableSvg)
    }
    if (mathEngine === 'KaTeX') {
      plugins.push(rehypeKatex)
    } else if (mathEngine === 'MathJax') {
      plugins.push(rehypeMathjax)
    }
    return plugins
  }, [mathEngine, hasRawHtml])

  const components = useMemo(() => {
    const map = {
      a: (props: any) => <Link {...props} />,
      code: (props: any) => <CodeBlock {...props} blockId={block.id} />,
      table: (props: any) => <Table {...props} blockId={block.id} />,
      img: (props: any) => <ImageViewer style={{ maxWidth: 500, maxHeight: 500 }} {...props} />,
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />,
      p: (props) => {
        const hasImage = props?.node?.children?.some((child: any) => child.tagName === 'img')
        if (hasImage) return <div {...props} />
        return <p {...props} />
      },
      svg: MarkdownSvgRenderer
    } as Partial<Components>
    if (hasStyleTag) {
      map.style = MarkdownShadowDomRenderer as any
    }
    return map
  }, [block.id, hasStyleTag])

  const urlTransform = useCallback((value: string) => {
    if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
    return defaultUrlTransform(value)
  }, [])

  // Key on the RESOLVED string, not `t`. react-i18next's `t` identity is not
  // stable across renders; depending on it minted a fresh `remarkRehypeOptions`
  // every frame, which broke `React.memo(MarkdownBlock)` for EVERY block (the
  // sealed ones too) → all blocks re-ran ReactMarkdown each commit. The string
  // only changes on language switch, so memo now actually skips sealed blocks.
  const footnoteLabel = t('common.footnotes')
  const remarkRehypeOptions = useMemo(
    () => ({
      footnoteLabel,
      footnoteLabelTagName: 'h4',
      footnoteBackContent: ' '
    }),
    [footnoteLabel]
  )

  const markdownCtx = useMemo<MarkdownBlockContextValue>(
    () => ({ content: block.content, isStreaming: block.status === 'streaming' }),
    [block.content, block.status]
  )

  // Incremental, append-only split. Streaming is append-only, so every
  // top-level block except the last is permanently sealed. Re-parsing the
  // WHOLE document every frame just to re-find boundaries is O(n) with n
  // growing → residual O(n²) (the cost that froze long answers). Instead we
  // cache the sealed prefix and only re-split the unsealed TAIL — cost is
  // O(last block), independent of total length. Sealed blocks keep identical
  // strings so their memoized `MarkdownBlock` is still skipped. When not
  // streaming, render the whole content as one block: one-time O(n), output
  // byte-identical to the pre-refactor single `<ReactMarkdown>`.
  const splitCacheRef = useRef<{ blockId: string; content: string; sealed: string[]; sealedLen: number }>({
    blockId: '',
    content: '',
    sealed: [],
    sealedLen: 0
  })

  let blocks: string[]
  if (!isStreaming) {
    splitCacheRef.current = { blockId: block.id, content: '', sealed: [], sealedLen: 0 }
    blocks = [messageContent]
  } else {
    const cache = splitCacheRef.current
    const appendOnly = cache.blockId === block.id && messageContent.startsWith(cache.content)
    const sealed = appendOnly ? cache.sealed : []
    const sealedLen = appendOnly ? cache.sealedLen : 0
    const tail = messageContent.slice(sealedLen)

    // `tail` starts exactly at a previously-confirmed top-level boundary, so
    // parsing it standalone yields the same boundaries as in-context (the
    // documented cross-block ref/footnote caveat already applies mid-stream).
    const tailBlocks = splitMarkdownBlocks(tail, remarkPlugins)

    // Every tail block but the last is now terminated → seal it. The last is
    // still potentially growing and stays live.
    const newlySealed = tailBlocks.slice(0, -1)
    const live = tailBlocks.length > 0 ? tailBlocks[tailBlocks.length - 1] : ''
    const nextSealed = newlySealed.length > 0 ? [...sealed, ...newlySealed] : sealed
    const nextSealedLen = sealedLen + newlySealed.reduce((s, b) => s + b.length, 0)

    splitCacheRef.current = {
      blockId: block.id,
      content: messageContent,
      sealed: nextSealed,
      sealedLen: nextSealedLen
    }
    blocks = live === '' && nextSealed.length > 0 ? nextSealed : [...nextSealed, live]
  }

  return (
    <MarkdownBlockContext value={markdownCtx}>
      <div className="markdown">
        {blocks.map((text, i) => (
          <MarkdownBlock
            // Index key: streaming is append-only, so a completed block keeps
            // its index/identity across chunks → memo hit. Only the last
            // (growing) block's `text` changes.
            key={i}
            index={i}
            text={text}
            blockId={block.id}
            remarkPlugins={remarkPlugins}
            rehypeBasePlugins={rehypeBasePlugins}
            components={components}
            urlTransform={urlTransform}
            remarkRehypeOptions={remarkRehypeOptions}
            disallowedElements={DISALLOWED_ELEMENTS}
          />
        ))}
      </div>
    </MarkdownBlockContext>
  )
}

export default memo(Markdown)
