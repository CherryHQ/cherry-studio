import { ThemeMode } from '@renderer/types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import styled from 'styled-components'

export const CollapsibleSettingGroup = styled(({ title, children, defaultExpanded = true, extra, ...rest }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <SettingGroup {...rest}>
      <GroupHeader>
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: 'pointer' }}>
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <GroupTitle>{title}</GroupTitle>
        </div>
        {extra && <div>{extra}</div>}
      </GroupHeader>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <ContentContainer
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}>
            <div>{children}</div>
          </ContentContainer>
        )}
      </AnimatePresence>
    </SettingGroup>
  )
})`
  margin-bottom: 4px;
`

const SettingGroup = styled.div<{ theme?: ThemeMode }>`
  padding: 0 5px;
  width: 100%;
  margin-top: 0;
  border-radius: 8px;
`

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 8px 0;
  padding-bottom: 12px;
  user-select: none;
  margin-bottom: 10px;
  border-bottom: 0.5px solid var(--color-border);
`

const GroupTitle = styled.div`
  font-weight: 500;
  margin-left: 4px;
  font-size: 14px;
`

const ContentContainer = styled(motion.div)`
  overflow: hidden;
`
