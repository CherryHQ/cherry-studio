import { memo, useCallback, useMemo } from 'react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip } from '@cherrystudio/ui'
import type { ActionTool } from '@renderer/components/ActionTools'

import { ToolWrapper } from './styles'

interface CodeToolButtonProps {
  tool: ActionTool
}

const CodeToolButton = ({ tool }: CodeToolButtonProps) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        tool.onClick?.()
      }
    },
    [tool]
  )

  const mainTool = useMemo(
    () => (
      <Tooltip key={tool.id} content={tool.tooltip} delay={500}>
        <ToolWrapper
          onClick={tool.onClick}
          onKeyDown={handleKeyDown}
          role="button"
          aria-label={tool.tooltip}
          tabIndex={0}>
          {tool.icon}
        </ToolWrapper>
      </Tooltip>
    ),
    [tool, handleKeyDown]
  )

  if (tool.children?.length) {
    return (
      <DropdownMenu modal={false}>
        <Tooltip key={tool.id} content={tool.tooltip} delay={500}>
          <DropdownMenuTrigger asChild>
            <ToolWrapper role="button" aria-label={tool.tooltip} tabIndex={0}>
              {tool.icon}
            </ToolWrapper>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-auto min-w-36 p-1">
          {tool.children.map((child) => (
            <DropdownMenuItem key={child.id} textValue={child.tooltip} onSelect={() => child.onClick?.()}>
              {child.icon}
              <span className="min-w-0 truncate">{child.tooltip}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return mainTool
}

export default memo(CodeToolButton)
