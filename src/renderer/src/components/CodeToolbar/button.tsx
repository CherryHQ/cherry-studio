import { Tooltip } from '@cherrystudio/ui'
import type { ActionTool } from '@renderer/components/ActionTools'
import { Dropdown } from 'antd'
import { memo, useCallback, useMemo } from 'react'

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
      <Tooltip key={tool.id} content={tool.tooltip} delay={500} closeDelay={0}>
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
      <Dropdown
        menu={{
          items: tool.children.map((child) => ({
            key: child.id,
            label: child.tooltip,
            icon: child.icon,
            onClick: child.onClick
          }))
        }}
        trigger={['click']}>
        {mainTool}
      </Dropdown>
    )
  }

  return mainTool
}

export default memo(CodeToolButton)
