import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { CodeBlockView } from '@renderer/components/CodeBlockView/CodeBlockView'
import { SPECIAL_VIEWS } from '@renderer/components/CodeBlockView/constants'
import Favicon from '@renderer/components/icons/FallbackFavicon'
import ImageViewer, { type ImageViewerProps } from '@renderer/components/ImageViewer'
import MarkdownShadowDomRenderer from '@renderer/components/MarkdownShadowDomRenderer'
import { OgCard } from '@renderer/components/OgCard'
import { parseFileLinkHref } from '@renderer/utils/filePath'
import { cn } from '@renderer/utils/style'
import { omit } from 'es-toolkit/compat'
import { ImageOff } from 'lucide-react'
import { type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, useMemo, useState } from 'react'
import type { Components, ExtraProps } from 'streamdown'
import { useIsCodeFenceIncomplete } from 'streamdown'

import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import { useMarkdownHost } from './useMarkdownHost'

type MarkdownRendererProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & ExtraProps

const IMAGE_STYLE: CSSProperties = { maxWidth: 500, maxHeight: 500 }
const PRE_STYLE: CSSProperties = { overflow: 'visible' }
const INLINE_CODE_CLASS = 'whitespace-pre-wrap! break-words! rounded-[5px] px-1! py-0.5! text-[0.95em]! leading-normal'

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

function MarkdownLinkRenderer(props: MarkdownRendererProps<'a'>) {
  const { openFilePath } = useMarkdownHost()
  const hostname = useMemo(() => {
    if (!props.href) return ''
    try {
      const url = new URL(props.href)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : ''
    } catch {
      return ''
    }
  }, [props.href])
  const [previewOpen, setPreviewOpen] = useState(false)

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

  const link = (() => {
    try {
      return decodeURIComponent(props.href ?? '')
    } catch {
      return props.href ?? ''
    }
  })()
  const linkContent =
    hostname && shouldShowMarkdownLinkFavicon(props.node) ? (
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
      onClick={(event) => event.stopPropagation()}>
      {linkContent}
    </a>
  )

  if (!link) return anchor

  return (
    <HoverCard openDelay={1500} closeDelay={100} onOpenChange={setPreviewOpen}>
      <HoverCardTrigger asChild>
        <span className="inline">{anchor}</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-none overflow-hidden rounded-lg p-0" sideOffset={0}>
        <OgCard link={link} show={previewOpen} />
      </HoverCardContent>
    </HoverCard>
  )
}

function MarkdownCodeRenderer({ children: rawChildren, className, node: _node }: MarkdownRendererProps<'code'>) {
  void _node
  const children = typeof rawChildren === 'string' ? rawChildren : String(rawChildren ?? '')
  const languageMatch = /language-([\w-+]+)/.exec(className || '')
  const isMultiline = children.includes('\n')
  const detectedLanguage = languageMatch?.[1] ?? (isMultiline ? 'text' : null)
  const language = useMemo(
    () =>
      detectedLanguage !== 'xml'
        ? detectedLanguage
        : /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(children)
          ? 'svg'
          : detectedLanguage,
    [children, detectedLanguage]
  )
  const isIncomplete = useIsCodeFenceIncomplete()

  if (language === null) {
    return <code className={cn(className, INLINE_CODE_CLASS)}>{children}</code>
  }

  return (
    <CodeBlockView
      language={language}
      editable={false}
      isStreaming={isIncomplete}
      showToolbar={SPECIAL_VIEWS.includes(language)}>
      {children}
    </CodeBlockView>
  )
}

function MarkdownTableRenderer({ children }: MarkdownRendererProps<'table'>) {
  return (
    <div className="table-wrapper relative my-2 w-full min-w-0 max-w-full">
      <div className="table-scroll-viewport w-full min-w-0 max-w-full overflow-x-auto">
        <table
          className="[&&_td]:wrap-break-word [&&_th]:wrap-break-word [&&]:my-0 [&&]:w-full [&&]:min-w-full [&&]:border-separate [&&]:bg-transparent [&&]:text-[0.9em] [&&]:text-foreground [&&]:leading-(--line-height-body-md) [&&_tbody]:bg-transparent [&&_td:last-child]:border-r-0 [&&_td]:border-border-subtle [&&_td]:border-r-[0.5px] [&&_td]:border-b-[0.5px] [&&_td]:bg-transparent [&&_td]:p-[0.5em] [&&_td]:align-top [&&_td]:font-normal [&&_td]:tracking-normal [&&_th:last-child]:border-r-0 [&&_th]:border-border-subtle [&&_th]:border-r-[0.5px] [&&_th]:border-b-[0.5px] [&&_th]:bg-muted [&&_th]:p-[0.5em] [&&_th]:text-left [&&_th]:align-top [&&_th]:font-semibold [&&_th]:tracking-normal [&&_thead]:bg-transparent [&&_tr:last-child_td]:border-b-0 [&&_tr]:bg-transparent"
          style={{
            border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            borderSpacing: 0,
            margin: 0,
            overflow: 'hidden'
          }}>
          {children}
        </table>
      </div>
    </div>
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
  table: MarkdownTableRenderer,
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
