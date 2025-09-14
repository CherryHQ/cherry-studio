import { ActionTool } from '@renderer/components/ActionTools'
import { Dropdown, Tooltip } from 'antd'
import { memo, useMemo } from 'react'

import { ToolWrapper } from './styles'

interface CodeToolButtonProps {
  tool: ActionTool
}

const CodeToolButton = ({ tool }: CodeToolButtonProps) => {
  const mainTool = useMemo(
    () => (
      <Tooltip key={tool.id} title={tool.tooltip} mouseEnterDelay={0.5} mouseLeaveDelay={0}>
        <ToolWrapper onClick={tool.onClick}>{tool.icon}</ToolWrapper>
      </Tooltip>
    ),
    [tool]
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
