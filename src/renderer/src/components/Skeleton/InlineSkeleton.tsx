import { Skeleton } from 'antd'
import type { FC } from 'react'

export interface SkeletonSpanProps {
  width?: string
}

export const SkeletonSpan: FC<SkeletonSpanProps> = ({ width = '60px' }) => {
  return (
    <Skeleton.Input
      active
      size="small"
      style={{
        width,
        minWidth: width,
        height: '1em',
        verticalAlign: 'middle'
      }}
    />
  )
}

SkeletonSpan.displayName = 'SkeletonSpan'
