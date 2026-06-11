import { Button } from '@cherrystudio/ui'
import { ChevronDown, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { useEffect, useState } from 'react'

import { ProgressBar } from './ProgressBar'
import { TRACE_ROW_GRID, type TraceNode } from './traceNode'

interface TraceTreeProps {
  node: TraceNode
  handleClick: (nodeId: string) => void
  treeData?: TraceNode[]
  paddingLeft?: number
}

export const convertTime = (time: number | null): string => {
  if (time == null) {
    return ''
  }
  if (time > 100000) {
    return `${(time / 1000).toFixed(0)}s`
  }
  if (time > 10000) {
    return `${(time / 1000).toFixed(1)}s`
  }
  if (time > 1000) {
    return `${(time / 1000).toFixed(2)}s`
  }
  if (time > 100) {
    return `${time.toFixed(0)}ms`
  }
  if (time > 10) {
    return `${time.toFixed(1)}ms`
  }
  return time.toFixed(2) + 'ms'
}

const TraceTree: React.FC<TraceTreeProps> = ({ node, handleClick, treeData, paddingLeft = 2 }) => {
  const [isOpen, setIsOpen] = useState(true)
  const hasChildren = node.children && node.children.length > 0
  const [usedTime, setUsedTime] = useState('--')

  // Recalculate while the span is still running.
  useEffect(() => {
    const endTime = node.endTime || Date.now()
    setUsedTime(convertTime(endTime - node.startTime))
  }, [node])

  return (
    <div className="w-full min-w-0 text-xs">
      <div
        className={`${TRACE_ROW_GRID} min-h-8 w-full px-2 hover:cursor-pointer hover:bg-accent max-[520px]:px-1 [&>div]:min-w-0`}
        onClick={(e) => {
          e.preventDefault()
          handleClick(node.id)
        }}>
        <div className="min-w-0 text-left" style={{ paddingLeft: `${paddingLeft}px` }}>
          <div className="flex min-w-0 flex-row items-center gap-1.5">
            <Button
              aria-label="Toggle"
              aria-expanded={isOpen ? true : false}
              variant="ghost"
              size="icon-sm"
              className="h-6 w-4 shrink-0 p-0"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setIsOpen(!isOpen)
              }}
              style={{
                visibility: hasChildren ? 'visible' : 'hidden'
              }}>
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </Button>
            <span
              role="button"
              tabIndex={0}
              className={`${node.status === 'ERROR' ? 'text-destructive' : 'text-foreground'} min-w-0 flex-1 cursor-pointer select-none [overflow-wrap:anywhere]`}>
              {node.name}
            </span>
          </div>
        </div>
        <div className="min-w-0 whitespace-nowrap text-center">
          <span>{usedTime}</span>
        </div>
        <div className="min-w-0 px-1 py-2 text-center">
          <ProgressBar progress={Math.max(node.percent, 5)} start={node.start} />
        </div>
      </div>
      <div className="h-[0.5px] w-full bg-border-subtle" />
      {hasChildren && isOpen && (
        <div>
          {node.children &&
            node.children
              .sort((a, b) => a.startTime - b.startTime)
              .map((childNode) => (
                <TraceTree
                  key={childNode.id}
                  treeData={treeData}
                  node={childNode}
                  handleClick={handleClick}
                  paddingLeft={paddingLeft + 4}
                />
              ))}
        </div>
      )}
    </div>
  )
}

export default TraceTree
