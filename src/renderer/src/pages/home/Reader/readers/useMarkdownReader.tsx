import { CodeBlockView } from '@renderer/components/CodeBlockView'
import ImageViewer from '@renderer/components/ImageViewer'
import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { useMemo } from 'react'
import ReactMarkdown, { Components, defaultUrlTransform } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import styled from 'styled-components'

const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup)/i
const DISALLOWED_ELEMENTS = ['iframe']

interface Props {
  markdownContent: string
}

const useMarkdownReader = (props: Props) => {
  const { markdownContent } = props

  const processedContent = useMemo(() => {
    const content = removeSvgEmptyLines(processLatexBrackets(markdownContent))
    return content
  }, [markdownContent])

  const rehypePlugins = useMemo(() => {
    const plugins: any[] = []
    if (ALLOWED_ELEMENTS.test(processedContent)) {
      plugins.push(rehypeRaw)
    }

    return plugins
  }, [processedContent])

  const components = useMemo(() => {
    return {
      img: (props: any) => <ImageViewer style={{ maxWidth: 500, maxHeight: 500 }} {...props} />,
      code: (props: any) => {
        if (!props.className) {
          return <code {...props} />
        }
        const match = /language-([\w-+]+)/.exec(props.className || '') || props.children?.includes('\n')
        const language = match?.[1] ?? 'text'
        return <CodeBlockView children={props.children} language={language} />
      },
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />,
      p: (props) => {
        const hasImage = props?.node?.children?.some((child: any) => child.tagName === 'img')
        if (hasImage) return <div {...props} />
        return <p {...props} />
      }
    } as Components
  }, [])

  if (processedContent.includes('<style>')) {
    components.style = MarkdownShadowDOMRenderer as any
  }

  const urlTransform = useMemo(
    () => (value: string) => {
      if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
      return defaultUrlTransform(value)
    },
    []
  )

  const Reader = (
    <MarkdownReader
      rehypePlugins={rehypePlugins}
      remarkPlugins={[remarkGfm, remarkCjkFriendly]}
      components={components}
      disallowedElements={DISALLOWED_ELEMENTS}
      urlTransform={urlTransform}>
      {processedContent}
    </MarkdownReader>
  )

  return useMemo(() => ({ Reader }), [markdownContent])
}

const MarkdownReader = styled(ReactMarkdown)`
  position: relative;
  overflow-y: auto;
  width: 100%;
  height: 100%;
  padding: 20px 12px;
  background-color: var(--color-background);
  text-overflow: wrap;
`

export default useMarkdownReader
