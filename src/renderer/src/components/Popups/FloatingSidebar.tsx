import HomeTabs from '@renderer/pages/home/Tabs/index'
import { Assistant, Topic } from '@renderer/types'
import { Popover } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import styled from 'styled-components'

interface Props {
  children: React.ReactNode
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

const FloatingSidebar: FC<Props> = ({ children, activeAssistant, setActiveAssistant, activeTopic, setActiveTopic }) => {
  const [open, setOpen] = useState(false)

  useHotkeys('esc', () => {
    setOpen(false)
  })

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

  const content = (
    <PopoverContent maxHeight={maxHeight}>
      <HomeTabs
        tab="assistants"
        activeAssistant={activeAssistant}
        activeTopic={activeTopic}
        setActiveAssistant={setActiveAssistant}
        setActiveTopic={setActiveTopic}
        style={{
          background: 'transparent',
          border: 'none',
          maxHeight: maxHeight
        }}
      />
    </PopoverContent>
  )

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      content={content}
      trigger={['hover', 'click', 'contextMenu']}
      placement="bottomRight"
      showArrow
      mouseEnterDelay={0.8} // 800ms delay before showing
      mouseLeaveDelay={20}
      styles={{
        body: {
          padding: 0
        }
      }}>
      {children}
    </Popover>
  )
}

const PopoverContent = styled.div<{ maxHeight: number }>`
  max-height: ${(props) => props.maxHeight}px;
`

export default FloatingSidebar
