import { HStack } from '@renderer/components/Layout'
import { Tooltip } from 'antd'
import { EllipsisVertical } from 'lucide-react'
import React, { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useCodeToolbar } from './context'
import { CodeTool } from './types'

interface CodeToolButtonProps {
  tool: CodeTool
}

const CodeToolButton: React.FC<CodeToolButtonProps> = memo(({ tool }) => {
  const { context } = useCodeToolbar()

  return (
    <Tooltip key={`${tool.id}-${tool.tooltip}`} title={tool.tooltip} mouseEnterDelay={0.5}>
      <ToolWrapper onClick={() => tool.onClick(context)}>{tool.icon}</ToolWrapper>
    </Tooltip>
  )
})

export const CodeToolbar: React.FC = memo(() => {
  const { tools, context } = useCodeToolbar()
  const [showQuickTools, setShowQuickTools] = useState(false)
  const { t } = useTranslation()

  // 根据条件显示工具
  const visibleTools = tools.filter((tool) => !tool.visible || tool.visible(context))

  // 按类型分组
  const coreTools = visibleTools.filter((tool) => tool.type === 'core')
  const quickTools = visibleTools.filter((tool) => tool.type === 'quick')

  if (visibleTools.length === 0) {
    return null
  }

  const hasQuickTools = quickTools.length > 0

  return (
    <StickyWrapper>
      <ToolbarWrapper className="code-toolbar">
        {/* 当有快捷工具且点击了More按钮时显示快捷工具 */}
        {hasQuickTools && showQuickTools && quickTools.map((tool) => <CodeToolButton key={tool.id} tool={tool} />)}

        {/* 当有快捷工具时显示More按钮 */}
        {hasQuickTools && (
          <Tooltip title={t('code_block.more')} mouseEnterDelay={0.5}>
            <ToolWrapper onClick={() => setShowQuickTools(!showQuickTools)} className={showQuickTools ? 'active' : ''}>
              <EllipsisVertical className="icon" />
            </ToolWrapper>
          </Tooltip>
        )}

        {/* 始终显示核心工具 */}
        {coreTools.map((tool) => (
          <CodeToolButton key={tool.id} tool={tool} />
        ))}
      </ToolbarWrapper>
    </StickyWrapper>
  )
})

const StickyWrapper = styled.div`
  position: sticky;
  top: 28px;
  z-index: 10;
`

const ToolbarWrapper = styled(HStack)`
  position: absolute;
  align-items: center;
  bottom: 0.2rem;
  right: 1.5rem;
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
  transition: all 0.2s ease;
  color: var(--color-text-3);

  &:hover {
    background-color: var(--color-background-soft);
    .icon {
      color: var(--color-text-1);
    }
  }

  &.active {
    color: var(--color-primary);
    .icon {
      color: var(--color-primary);
    }
  }

  /* For Lucide icons */
  .icon {
    width: 14px;
    height: 14px;
    color: var(--color-text-3);
  }
`
