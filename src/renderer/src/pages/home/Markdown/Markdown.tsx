import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'

import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { MainTextMessageBlock, ThinkingMessageBlock, TranslationMessageBlock } from '@renderer/types/newMessage'
import { parseJSON } from '@renderer/utils'
import { escapeBrackets, removeSvgEmptyLines } from '@renderer/utils/formats'
import { findCitationInChildren, getCodeBlockId } from '@renderer/utils/markdown'
import { isEmpty } from 'lodash'
import { type FC, memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
// @ts-ignore rehype-mathjax is not typed
import rehypeMathjax from 'rehype-mathjax'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import CodeBlock from './CodeBlock'
import ImagePreview from './ImagePreview'
import Link from './Link'

const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup)/i
const DISALLOWED_ELEMENTS = ['iframe']

interface Props {
  // message: Message & { content: string }
  block: MainTextMessageBlock | TranslationMessageBlock | ThinkingMessageBlock
}

const Markdown: FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  const { mathEngine } = useSettings()

  const remarkPlugins = useMemo(() => {
    const plugins = [remarkGfm, remarkCjkFriendly]
    if (mathEngine !== 'none') {
      plugins.push(remarkMath)
    }
    return plugins
  }, [mathEngine])

  const messageContent = useMemo(() => {
    const empty = isEmpty(block.content)
    const paused = block.status === 'paused'
    const content = empty && paused ? t('message.chat.completion.paused') : block.content
    return removeSvgEmptyLines(escapeBrackets(content))
  }, [block, t])

  const rehypePlugins = useMemo(() => {
    const plugins: any[] = []
    if (ALLOWED_ELEMENTS.test(messageContent)) {
      plugins.push(rehypeRaw)
    }
    if (mathEngine === 'KaTeX') {
      plugins.push(rehypeKatex as any)
    } else if (mathEngine === 'MathJax') {
      plugins.push(rehypeMathjax as any)
    }
    return plugins
  }, [mathEngine, messageContent])

  const onSaveCodeBlock = useCallback(
    (id: string, newContent: string) => {
      EventEmitter.emit(EVENT_NAMES.EDIT_CODE_BLOCK, {
        msgBlockId: block.id,
        codeBlockId: id,
        newContent
      })
    },
    [block.id]
  )

  const components = useMemo(() => {
    return {
      a: (props: any) => <Link {...props} citationData={parseJSON(findCitationInChildren(props.children))} />,
      code: (props: any) => (
        <CodeBlock {...props} id={getCodeBlockId(props?.node?.position?.start)} onSave={onSaveCodeBlock} />
      ),
      img: ImagePreview,
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />
    } as Partial<Components>
  }, [onSaveCodeBlock])

  // if (role === 'user' && !renderInputMessageAsMarkdown) {
  //   return <p style={{ marginBottom: 5, whiteSpace: 'pre-wrap' }}>{messageContent}</p>
  // }

  if (messageContent.includes('<style>')) {
    components.style = MarkdownShadowDOMRenderer as any
  }

  return (
    <ReactMarkdown
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
      className="markdown"
      components={components}
      disallowedElements={DISALLOWED_ELEMENTS}
      remarkRehypeOptions={{
        footnoteLabel: t('common.footnotes'),
        footnoteLabelTagName: 'h4',
        footnoteBackContent: ' '
      }}>
      {messageContent}
    </ReactMarkdown>
  )
}

export default memo(Markdown)
