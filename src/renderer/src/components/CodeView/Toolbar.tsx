import { Tool, useToolbar } from '@renderer/components/CodeView/context'
import { HStack } from '@renderer/components/Layout'
import { Tooltip } from 'antd'
import React, { memo } from 'react'
import styled from 'styled-components'

interface ToolButtonProps {
  tool: Tool
}

const ToolButton: React.FC<ToolButtonProps> = memo(({ tool }) => {
  const { context } = useToolbar()

  return (
    <Tooltip title={tool.tooltip} mouseEnterDelay={0.5}>
      <ToolWrapper onClick={() => tool.onClick(context)}>{tool.icon}</ToolWrapper>
    </Tooltip>
  )
})

const Toolbar: React.FC = () => {
  const { tools, context } = useToolbar()

  // 根据条件显示工具
  const visibleTools = tools.filter((tool) => !tool.condition || tool.condition(context))

  // 按类型分组
  const coreTools = visibleTools.filter((tool) => tool.type === 'core')
  const previewTools = visibleTools.filter((tool) => tool.type === 'preview')

  if (visibleTools.length === 0) {
    return null
  }

  return (
    <StickyWrapper>
      <ToolbarWrapper>
        {previewTools.map((tool) => (
          <ToolButton key={tool.id} tool={tool} />
        ))}
        {coreTools.map((tool) => (
          <ToolButton key={tool.id} tool={tool} />
        ))}
      </ToolbarWrapper>
    </StickyWrapper>
  )
}

const StickyWrapper = styled.div`
  position: sticky;
  top: 28px;
  z-index: 10;
`

const ToolbarWrapper = styled(HStack)`
  position: absolute;
  align-items: center;
  bottom: 0.2rem;
  right: 1rem;
  height: 27px;
  gap: 12px;
`

const ToolWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-3);
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text-1);
  }
`

export default memo(Toolbar)
