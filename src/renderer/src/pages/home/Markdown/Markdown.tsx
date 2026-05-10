import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'
import 'remark-github-blockquote-alert/alert.css'

import ImageViewer from '@renderer/components/ImageViewer'
import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import { useSettings } from '@renderer/hooks/useSettings'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import type {
  CompactMessageBlock,
  MainTextMessageBlock,
  ThinkingMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'
import { type BidiDir, detectBidiDirFromText } from '@renderer/utils/bidi'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { isEmpty } from 'lodash'
import { type FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
// @ts-ignore rehype-mathjax is not typed
import rehypeMathjax from 'rehype-mathjax'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkAlert from 'remark-github-blockquote-alert'
import remarkMath from 'remark-math'
import type { Pluggable } from 'unified'

import CodeBlock from './CodeBlock'
import Link from './Link'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import rehypeHeadingIds from './plugins/rehypeHeadingIds'
import rehypeScalableSvg from './plugins/rehypeScalableSvg'
import remarkDisableConstructs from './plugins/remarkDisableConstructs'
import Table from './Table'

const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup|details|summary)/i
const DISALLOWED_ELEMENTS = ['iframe', 'script']

const nodeToPlainText = (node: any): string => {
  if (!node) return ''

  // hast "text" node
  if (node.type === 'text' && typeof node.value === 'string') return node.value

  // hast "element" node
  if (node.type === 'element') {
    const tagName = String(node.tagName || '').toLowerCase()
    if (tagName === 'pre' || tagName === 'code' || tagName === 'mjx-container' || tagName === 'svg') return ''

    const className = node.properties?.className
    const classNames = Array.isArray(className)
      ? className
      : typeof className === 'string'
        ? className.split(/\s+/)
        : []
    if (classNames.includes('katex') || classNames.includes('katex-display') || classNames.includes('math')) return ''
    if (classNames.includes('hljs') || classNames.includes('shiki')) return ''
  }

  if (Array.isArray(node.children)) return node.children.map(nodeToPlainText).join('')
  return ''
}

const dirForMarkdownNode = (node: any): BidiDir => {
  const text = nodeToPlainText(node).trim()
  return detectBidiDirFromText(text)
}

interface Props {
  // message: Message & { content: string }
  block: MainTextMessageBlock | TranslationMessageBlock | ThinkingMessageBlock | CompactMessageBlock
  // 可选的后处理函数，用于在流式渲染过程中处理文本（如引用标签转换）
  postProcess?: (text: string) => string
}

const Markdown: FC<Props> = ({ block, postProcess }) => {
  const { t } = useTranslation()
  const { mathEngine, mathEnableSingleDollar, experimentalRtlTextFix } = useSettings()

  const isTrulyDone = 'status' in block && block.status === 'success'
  const [displayedContent, setDisplayedContent] = useState(postProcess ? postProcess(block.content) : block.content)
  const [isStreamDone, setIsStreamDone] = useState(isTrulyDone)

  const prevContentRef = useRef(block.content)
  const prevBlockIdRef = useRef(block.id)

  const { addChunk, reset } = useSmoothStream({
    onUpdate: (rawText) => {
      // 如果提供了后处理函数就调用，否则直接使用原始文本
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

    const isContentReset = oldContent && newContent && !newContent.startsWith(oldContent)

    if (isDifferentBlock || isContentReset) {
      reset(newContent)
    } else {
      const delta = newContent.substring(oldContent.length)
      if (delta) {
        addChunk(delta)
      }
    }

    prevContentRef.current = newContent
    prevBlockIdRef.current = block.id

    // 更新 stream 状态
    const isStreaming = block.status === 'streaming'
    setIsStreamDone(!isStreaming)
  }, [block.content, block.id, block.status, addChunk, reset])

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

  const messageContent = useMemo(() => {
    if ('status' in block && block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    return removeSvgEmptyLines(processLatexBrackets(displayedContent))
  }, [block, displayedContent, t])

  const rehypePlugins = useMemo(() => {
    const plugins: Pluggable[] = []
    if (ALLOWED_ELEMENTS.test(messageContent)) {
      plugins.push(rehypeRaw, rehypeScalableSvg)
    }
    plugins.push([rehypeHeadingIds, { prefix: `heading-${block.id}` }])
    if (mathEngine === 'KaTeX') {
      plugins.push(rehypeKatex)
    } else if (mathEngine === 'MathJax') {
      plugins.push(rehypeMathjax)
    }
    return plugins
  }, [mathEngine, messageContent, block.id])

  const components = useMemo(() => {
    return {
      a: (props: any) => <Link {...props} />,
      code: (props: any) => <CodeBlock {...props} blockId={block.id} />,
      table: (props: any) => <Table {...props} blockId={block.id} />,
      img: (props: any) => <ImageViewer style={{ maxWidth: 500, maxHeight: 500 }} {...props} />,
      pre: (props: any) => (
        <pre
          {...props}
          dir={experimentalRtlTextFix ? 'ltr' : undefined}
          style={{ overflow: 'visible', ...props?.style }}
        />
      ),
      p: (props) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        const hasImage = props?.node?.children?.some((child: any) => child.tagName === 'img')
        if (hasImage) return <div {...props} dir={dir} />
        return <p {...props} dir={dir} />
      },
      li: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <li {...props} dir={dir} />
      },
      ul: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <ul {...props} dir={dir} />
      },
      ol: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <ol {...props} dir={dir} />
      },
      blockquote: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <blockquote {...props} dir={dir} />
      },
      h1: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <h1 {...props} dir={dir} />
      },
      h2: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <h2 {...props} dir={dir} />
      },
      h3: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <h3 {...props} dir={dir} />
      },
      h4: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <h4 {...props} dir={dir} />
      },
      h5: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <h5 {...props} dir={dir} />
      },
      h6: (props: any) => {
        const dir = experimentalRtlTextFix ? dirForMarkdownNode(props?.node) : undefined
        return <h6 {...props} dir={dir} />
      },
      svg: MarkdownSvgRenderer
    } as Partial<Components>
  }, [block.id, experimentalRtlTextFix])

  if (/<style\b[^>]*>/i.test(messageContent)) {
    components.style = MarkdownShadowDOMRenderer as any
  }

  const urlTransform = useCallback((value: string) => {
    if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
    return defaultUrlTransform(value)
  }, [])

  return (
    <div className="markdown">
      <ReactMarkdown
        rehypePlugins={rehypePlugins}
        remarkPlugins={remarkPlugins}
        components={components}
        disallowedElements={DISALLOWED_ELEMENTS}
        urlTransform={urlTransform}
        remarkRehypeOptions={{
          footnoteLabel: t('common.footnotes'),
          footnoteLabelTagName: 'h4',
          footnoteBackContent: ' '
        }}>
        {messageContent}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
