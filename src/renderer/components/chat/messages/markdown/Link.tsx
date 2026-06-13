import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { cn } from '@renderer/utils'
import { parseJSON } from '@renderer/utils/json'
import { findCitationInChildren } from '@renderer/utils/markdown'
import { isEmpty, omit } from 'lodash'
import React, { useMemo } from 'react'
import type { Node } from 'unist'

import CitationTooltip, { CitationSchema } from './CitationTooltip'
import Hyperlink from './Hyperlink'

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  node?: Omit<Node, 'type'>
}

function getWebHostname(href?: string): string {
  if (!href) return ''

  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : ''
  } catch {
    return ''
  }
}

function hasFaviconChild(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => React.isValidElement(child) && child.type === Favicon)
}

const Link: React.FC<LinkProps> = (props) => {
  const citationData = useMemo(() => {
    const raw = parseJSON(findCitationInChildren(props.children))
    const parsed = CitationSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, [props.children])
  const hostname = useMemo(() => getWebHostname(props.href), [props.href])
  const containsFaviconChild = useMemo(() => hasFaviconChild(props.children), [props.children])

  // 处理内部链接
  if (props.href?.startsWith('#')) {
    return <span className="link">{props.children}</span>
  }

  // 包含<sup>标签表示是一个引用链接
  const isCitation = React.Children.toArray(props.children).some((child) => {
    if (typeof child === 'object' && 'type' in child) {
      return child.type === 'sup'
    }
    return false
  })
  const showFavicon = !!hostname && !isCitation && !containsFaviconChild
  const linkClassName = cn('text-primary', !props.className && !isCitation && 'hover:underline', props.className)
  const linkContent = showFavicon ? (
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

  // 如果是引用链接并且有引用数据，则使用CitationTooltip
  if (isCitation && citationData) {
    return (
      <CitationTooltip citation={citationData}>
        <a
          {...omit(props, ['node', 'citationData'])}
          href={isEmpty(props.href) ? undefined : props.href}
          target="_blank"
          rel="noreferrer"
          className={linkClassName}
          onClick={(e) => e.stopPropagation()}
        />
      </CitationTooltip>
    )
  }

  // 普通链接
  return (
    <Hyperlink href={props.href || ''}>
      <a
        {...omit(props, ['node', 'citationData'])}
        target="_blank"
        rel="noreferrer"
        className={linkClassName}
        onClick={(e) => e.stopPropagation()}>
        {linkContent}
      </a>
    </Hyperlink>
  )
}

export default Link
