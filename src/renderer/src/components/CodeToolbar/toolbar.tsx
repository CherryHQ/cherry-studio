import { HStack } from '@renderer/components/Layout'
import { Tooltip } from 'antd'
import { EllipsisVertical } from 'lucide-react'
import React, { memo, useMemo, useState } from 'react'
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

  // 点击了 more 按钮或者只有一个快捷工具时
  const quickToolButtons = useMemo(() => {
    if (quickTools.length === 1 || (quickTools.length > 1 && showQuickTools)) {
      return quickTools.map((tool) => <CodeToolButton key={tool.id} tool={tool} />)
    }

    return null
  }, [quickTools, showQuickTools])

  if (visibleTools.length === 0) {
    return null
  }

  return (
    <StickyWrapper>
      <ToolbarWrapper className="code-toolbar">
        {/* 有多个快捷工具时通过 more 按钮展示 */}
        {quickToolButtons}
        {quickTools.length > 1 && (
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
  bottom: 0.3rem;
  right: 0.5rem;
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
  user-select: none;
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
