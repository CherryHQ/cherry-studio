import { omit } from 'lodash'
import React from 'react'

import CitationTooltip from './CitationTooltip'

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  node?: any
  citationData?: {
    url: string
    title?: string
    content?: string
  }
}

const Link: React.FC<LinkProps> = (props) => {
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

  // 如果是引用链接并且有引用数据，则使用CitationTooltip
  if (isCitation && props.citationData) {
    return (
      <CitationTooltip citation={props.citationData}>
        <a
          {...omit(props, ['node', 'citationData'])}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        />
      </CitationTooltip>
    )
  }

  // 普通链接
  return (
    <a
      {...omit(props, ['node', 'citationData'])}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    />
  )
}

export default Link
