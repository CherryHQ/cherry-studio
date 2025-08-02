import { ActionTool } from '@renderer/components/ActionTools'
import { HStack } from '@renderer/components/Layout'
import { Tooltip } from 'antd'
import { EllipsisVertical } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import CodeToolButton from './button'
import { ToolWrapper } from './styles'

const CodeToolbar = ({ tools }: { tools: ActionTool[] }) => {
  const [showQuickTools, setShowQuickTools] = useState(false)
  const { t } = useTranslation()

  // 根据条件显示工具
  const visibleTools = tools.filter((tool) => !tool.visible || tool.visible())

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
              <EllipsisVertical className="tool-icon" />
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
}

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

export default memo(CodeToolbar)
