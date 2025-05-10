import EmojiIcon from '@renderer/components/EmojiIcon'
import { Center } from '@renderer/components/Layout'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { Assistant } from '@renderer/types'
import { Popover } from 'antd'
import { Empty } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Scrollbar from '../Scrollbar'

interface Props {
  children: React.ReactNode
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
}

const FloatingSidebar: FC<Props> = ({ children, activeAssistant, setActiveAssistant }) => {
  const [open, setOpen] = useState(false)
  const { assistants } = useAssistants()
  const { t } = useTranslation()

  useHotkeys('esc', () => {
    setOpen(false)
  })

  const handleClose = () => {
    setOpen(false)
  }

  const [maxHeight, setMaxHeight] = useState(Math.floor(window.innerHeight * 0.75))

  useEffect(() => {
    const handleResize = () => {
      setMaxHeight(Math.floor(window.innerHeight * 0.75))
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const handleSwitchAssistant = (assistant: Assistant) => {
    setActiveAssistant(assistant)
    handleClose()
  }

  const content = (
    <PopoverContent maxHeight={maxHeight}>
      <SidebarHeader>
        <SidebarTitle>{t('assistants.title')}</SidebarTitle>
      </SidebarHeader>

      <AssistantsList>
        {assistants.map((assistant) => (
          <AssistantItem
            key={assistant.id}
            active={assistant.id === activeAssistant.id}
            onClick={() => handleSwitchAssistant(assistant)}>
            <AssistantAvatar>
              <EmojiIcon emoji={assistant.emoji || ''} />
            </AssistantAvatar>
            <AssistantName>{assistant.name}</AssistantName>
          </AssistantItem>
        ))}
        {isEmpty(assistants) && (
          <Center>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </Center>
        )}
      </AssistantsList>
    </PopoverContent>
  )

  return (
    <Popover
      open={open}
      onOpenChange={(visible) => {
        setOpen(visible)
      }}
      content={content}
      trigger={['hover', 'click']}
      placement="rightTop"
      arrow={false}
      mouseEnterDelay={0.8} // 800ms delay before showing
      mouseLeaveDelay={0.3} // 300ms delay before hiding when mouse leaves
      styles={{
        body: {
          padding: 0,
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          boxShadow: '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12)'
        }
      }}>
      {children}
    </Popover>
  )
}

const PopoverContent = styled(Scrollbar)<{ maxHeight: number }>`
  max-height: ${(props) => props.maxHeight}px;
  overflow-y: auto;
  width: 240px;
`

const SidebarHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 12px 6px 12px;
  border-bottom: 0.5px solid var(--color-border);
`

const SidebarTitle = styled.div`
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text-1);
`

const AssistantsList = styled.div`
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 4px;
`

const AssistantItem = styled.div<{ active: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 7px 10px;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid ${(props) => (props.active ? 'var(--color-border)' : 'transparent')};
  background-color: ${(props) => (props.active ? 'var(--color-background-soft)' : 'transparent')};
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-background-soft);
  }
`

const AssistantAvatar = styled.div`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
`

const AssistantName = styled.div`
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  flex: 1;
`

export default FloatingSidebar
