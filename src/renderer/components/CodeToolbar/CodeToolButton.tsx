import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import type { ActionTool } from '@renderer/components/ActionTools'
import { memo, useCallback, useMemo, useState } from 'react'

import { ToolWrapper } from './styles'

interface CodeToolButtonProps {
  tool: ActionTool
}

const CodeToolButton = ({ tool }: CodeToolButtonProps) => {
  const [open, setOpen] = useState(false)

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

  if (tool.children?.length && tool.children.length > 0) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip key={tool.id} content={tool.tooltip} delay={500}>
          <PopoverTrigger asChild>
            <ToolWrapper
              onClick={tool.onClick}
              onKeyDown={handleKeyDown}
              role="button"
              aria-label={tool.tooltip}
              tabIndex={0}>
              {tool.icon}
            </ToolWrapper>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent align="end" className="w-auto min-w-36 p-1">
          <MenuList className="gap-1">
            {tool.children.map((child) => (
              <MenuItem
                key={child.id}
                icon={child.icon}
                label={child.tooltip ?? ''}
                onClick={() => {
                  child.onClick?.()
                  setOpen(false)
                }}
              />
            ))}
          </MenuList>
        </PopoverContent>
      </Popover>
    )
  }

  return mainTool
}

export default memo(CodeToolButton)
