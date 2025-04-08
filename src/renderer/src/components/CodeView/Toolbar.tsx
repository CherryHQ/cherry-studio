import { MoreOutlined } from '@ant-design/icons'
import { Tool, useToolbar } from '@renderer/components/CodeView/context'
import { HStack } from '@renderer/components/Layout'
import { Tooltip } from 'antd'
import React, { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const [showQuickTools, setShowQuickTools] = useState(false)
  const { t } = useTranslation()

  // 根据条件显示工具
  const visibleTools = tools.filter((tool) => !tool.condition || tool.condition(context))

  // 按类型分组
  const coreTools = visibleTools.filter((tool) => tool.type === 'core')
  const quickTools = visibleTools.filter((tool) => tool.type === 'quick')

  if (visibleTools.length === 0) {
    return null
  }

  const hasQuickTools = quickTools.length > 0

  return (
    <StickyWrapper>
      <ToolbarWrapper>
        {/* 当有快捷工具且点击了More按钮时显示快捷工具 */}
        {hasQuickTools && showQuickTools && quickTools.map((tool) => <ToolButton key={tool.id} tool={tool} />)}

        {/* 当有快捷工具时显示More按钮 */}
        {hasQuickTools && (
          <Tooltip title={t('code_block.more')} mouseEnterDelay={0.5}>
            <ToolWrapper onClick={() => setShowQuickTools(!showQuickTools)} className={showQuickTools ? 'active' : ''}>
              <MoreOutlined />
            </ToolWrapper>
          </Tooltip>
        )}

        {/* 始终显示核心工具 */}
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
  height: 24px;
  gap: 4px;
`

const ToolWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-3);
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text-1);
  }

  &.active {
    color: var(--color-primary);
  }
`

export default memo(Toolbar)
