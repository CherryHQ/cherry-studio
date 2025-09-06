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

function isLocalFilePath(path: string): boolean {
  if (/^https?:\/\//i.test(path)) return false
  if (path.startsWith('/')) return true
  if (/^[a-zA-Z]:\\/.test(path) || path.startsWith('\\\\')) return true
  return false
}

const Link: React.FC<LinkProps> = (props) => {
  const citationData = useMemo(() => {
    const raw = parseJSON(findCitationInChildren(props.children))
    if (raw?.url && isLocalFilePath(raw.url)) {
      raw.url = 'file://' + raw.url
    }
    const parsed = CitationSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, [props.children])

  const href = useMemo(() => {
    return citationData?.url || props.href
  }, [citationData, props.href])

  // 处理内部链接
  if (href?.startsWith('#')) {
    return <span className="link">{props.children}</span>
  }

  // 包含<sup>标签表示是一个引用链接
  const isCitation = React.Children.toArray(props.children).some((child) => {
    if (typeof child === 'object' && 'type' in child) {
      return child.type === 'sup'
    }
    return false
  })

  // 如果是引用链接并且有引用数据，则使用CitationTooltip
  if (isCitation && citationData) {
    return (
      <CitationTooltip citation={citationData}>
        <a
          {...omit(props, ['node', 'citationData'])}
          href={isEmpty(href) ? undefined : href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        />
      </CitationTooltip>
    )
  }

  // 普通链接
  return (
    <Hyperlink href={href || ''}>
      <a
        {...omit(props, ['node', 'citationData'])}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
      />
    </Hyperlink>
  )
}

export default Link
