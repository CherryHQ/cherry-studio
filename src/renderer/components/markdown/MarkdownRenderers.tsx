import { omit } from 'es-toolkit/compat'
import { ImageOff } from 'lucide-react'
import {
  Children,
  isValidElement,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  useMemo,
  useState
} from 'react'
import type { Components, ExtraProps } from 'streamdown'

import { CodeBlockView } from '@renderer/components/CodeBlockView/CodeBlockView'
import Favicon from '@renderer/components/icons/FallbackFavicon'
import ImageViewer, { type ImageViewerProps } from '@renderer/components/ImageViewer'
import MarkdownShadowDomRenderer from '@renderer/components/MarkdownShadowDomRenderer'
import { parseFileLinkHref } from '@renderer/utils/filePath'
import { cn } from '@renderer/utils/style'

import MarkdownHyperlink from './MarkdownHyperlink'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import MarkdownTable from './MarkdownTable'
import { INLINE_CODE_CLASS, useMarkdownCode } from './useMarkdownCode'
import { useMarkdownHost, type MarkdownHost } from './useMarkdownHost'
import { useMarkdownStreaming } from './useMarkdownStreaming'

type MarkdownRendererProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & ExtraProps

const IMAGE_STYLE: CSSProperties = { maxWidth: 500, maxHeight: 500 }
const PRE_STYLE: CSSProperties = { overflow: 'visible' }

export function shouldShowMarkdownLinkFavicon(node: ExtraProps['node']): boolean {
  if (!node) return true
  if (node.children.some((child) => child.type === 'element')) return false

  const onlyChild = node.children.length === 1 ? node.children[0] : null
  return !(
    onlyChild?.type === 'text' &&
    typeof onlyChild.value === 'string' &&
    /^https?:\/\/\S+$/i.test(onlyChild.value.trim())
  )
}

export function scrollToMarkdownAnchor(event: ReactMouseEvent<HTMLAnchorElement>): void {
  event.stopPropagation()

  const href = event.currentTarget.getAttribute('href')
  if (!href?.startsWith('#')) return

  let fragment: string
  try {
    fragment = decodeURIComponent(href.slice(1))
  } catch {
    return
  }
  if (!fragment) return

  const markdown = event.currentTarget.closest('.markdown')
  const target = Array.from(markdown?.querySelectorAll<HTMLElement>('[id]') ?? []).find(
    (element) =>
      element.id === fragment || element.id === `user-content-${fragment}` || element.id.endsWith(`--${fragment}`)
  )
  if (!target) return

  event.preventDefault()
  target.scrollIntoView({ block: 'start' })
}

export function MarkdownLinkRenderer({
  openFilePath: fileOpener,
  openExternalUrl: urlOpener,
  ...props
}: MarkdownRendererProps<'a'> & Pick<MarkdownHost, 'openFilePath' | 'openExternalUrl'>) {
  const host = useMarkdownHost()
  const openFilePath = fileOpener ?? host.openFilePath
  const openExternalUrl = urlOpener ?? host.openExternalUrl
  const hostname = useMemo(() => {
    if (!props.href) return ''
    try {
      const url = new URL(props.href)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : ''
    } catch {
      return ''
    }
  }, [props.href])

  if (props.href?.startsWith('#')) {
    return (
      <a
        {...omit(props, ['node'])}
        className={cn('text-link', !props.className && 'hover:underline', props.className)}
        onClick={(event) => {
          props.onClick?.(event)
          if (!event.defaultPrevented) scrollToMarkdownAnchor(event)
        }}>
        {props.children}
      </a>
    )
  }

  const fileLinkPath = openFilePath ? parseFileLinkHref(props.href) : null
  if (fileLinkPath && openFilePath) {
    return (
      <a
        {...omit(props, ['node'])}
        href={props.href}
        className={cn('text-link', !props.className && 'hover:underline', props.className)}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void Promise.resolve(openFilePath(fileLinkPath)).catch(() => {})
        }}>
        {props.children}
      </a>
    )
  }

  const linkContent =
    hostname &&
    !Children.toArray(props.children).some((child) => isValidElement(child) && child.type === Favicon) &&
    shouldShowMarkdownLinkFavicon(props.node) ? (
      <>
        <span
          className="markdown-link-favicon mr-1 inline-flex size-4 items-center justify-center align-[-0.125em]"
          aria-hidden="true">
          <Favicon hostname={hostname} alt="" />
        </span>
        {props.children}
      </>
    ) : (
      props.children
    )
  const anchor = (
    <a
      {...omit(props, ['node'])}
      target="_blank"
      rel="noreferrer"
      className={cn('text-link', !props.className && 'hover:underline', props.className)}
      onClick={(event) => {
        event.stopPropagation()
        props.onClick?.(event)
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          !hostname ||
          !openExternalUrl
        )
          return
        event.preventDefault()
        void openExternalUrl(props.href!)
      }}>
      {linkContent}
    </a>
  )

  return (
    <MarkdownHyperlink href={props.href ?? ''} onOpenLink={hostname ? openExternalUrl : undefined}>
      {anchor}
    </MarkdownHyperlink>
  )
}

function MarkdownCodeRenderer({ children: rawChildren, className, node: _node }: MarkdownRendererProps<'code'>) {
  void _node
  const { text, language, isIncomplete } = useMarkdownCode(rawChildren, className)
  const isStreaming = useMarkdownStreaming()

  if (language === null) {
    return <code className={cn(className, INLINE_CODE_CLASS)}>{rawChildren}</code>
  }

  return (
    <CodeBlockView
      language={language}
      editable={false}
      allowExecution={false}
      isStreaming={isStreaming || isIncomplete}>
      {text}
    </CodeBlockView>
  )
}

export function MarkdownImageRenderer(props: MarkdownRendererProps<'img'>) {
  const { alt, node: _node, onError, src, style, ...imageProps } = props
  const [failedSource, setFailedSource] = useState<string | null>(null)
  void _node

  if (!src) return null

  if (failedSource === src) {
    if (!alt) return null

    return (
      <span
        role="img"
        aria-label={alt}
        className="inline-flex min-h-8 max-w-full items-center justify-center gap-1.5 rounded-md border-[0.5px] border-border-subtle bg-background-subtle px-2 py-1 text-muted-foreground text-sm"
        style={{ width: imageProps.width, height: imageProps.height, ...(style ?? IMAGE_STYLE) }}>
        <ImageOff className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{alt}</span>
      </span>
    )
  }

  return (
    <ImageViewer
      {...(imageProps as ImageViewerProps)}
      alt={alt}
      src={src}
      style={style ?? IMAGE_STYLE}
      onError={(event) => {
        setFailedSource(src)
        onError?.(event)
      }}
    />
  )
}

function MarkdownPreRenderer({ node: _node, ...props }: MarkdownRendererProps<'pre'>) {
  void _node
  return <pre style={PRE_STYLE} {...props} />
}

function MarkdownParagraphRenderer({ node, ...props }: MarkdownRendererProps<'p'>) {
  const hasImage = node?.children.some((child) => child.type === 'element' && child.tagName === 'img')
  if (hasImage) return <div {...props} />
  return <p {...props} />
}

const MARKDOWN_COMPONENTS = {
  a: MarkdownLinkRenderer,
  code: MarkdownCodeRenderer,
  table: MarkdownTable,
  img: MarkdownImageRenderer,
  pre: MarkdownPreRenderer,
  p: MarkdownParagraphRenderer,
  svg: MarkdownSvgRenderer as Components['svg']
} satisfies Partial<Components>

const MARKDOWN_COMPONENTS_WITH_STYLE = {
  ...MARKDOWN_COMPONENTS,
  style: MarkdownShadowDomRenderer as Components['style']
} satisfies Partial<Components>

interface UseMarkdownComponentsOptions {
  components?: Partial<Components>
  hasStyleElement: boolean
}

export function useMarkdownComponents({ components, hasStyleElement }: UseMarkdownComponentsOptions) {
  const appComponents = hasStyleElement ? MARKDOWN_COMPONENTS_WITH_STYLE : MARKDOWN_COMPONENTS
  return useMemo(() => (components ? { ...appComponents, ...components } : appComponents), [appComponents, components])
}
