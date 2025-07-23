import { TopView } from '@renderer/components/TopView'
import { isMac } from '@renderer/config/constant'
import { Assistant, Topic } from '@renderer/types'
import { Drawer } from 'antd'
import { useState } from 'react'

import HomeTabs from '../Tabs'

interface ShowParams {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({
  activeAssistant,
  setActiveAssistant,
  activeTopic,
  setActiveTopic,
  resolve
}) => {
  const [open, setOpen] = useState(true)

  const onClose = () => {
    setOpen(false)
    setTimeout(resolve, 300)
  }

  AssistantsDrawer.hide = onClose

  return (
    <Drawer
      title={null}
      height="100vh"
      placement="left"
      open={open}
      onClose={onClose}
      style={{ width: 'var(--assistants-width)' }}
      styles={{
        header: { display: 'none' },
        body: {
          display: 'flex',
          padding: 0,
          paddingTop: isMac ? 'var(--navbar-height)' : 0,
          height: 'calc(100vh - var(--navbar-height))',
          overflow: 'hidden',
          backgroundColor: 'var(--color-background-opacity)'
        },
        wrapper: {
          width: 'var(--assistants-width)'
        }
      }}>
      <HomeTabs
        activeAssistant={activeAssistant}
        activeTopic={activeTopic}
        setActiveAssistant={(assistant) => {
          setActiveAssistant(assistant)
          onClose()
        }}
        setActiveTopic={(topic) => {
          setActiveTopic(topic)
          onClose()
        }}
        position="left"
      />
    </Drawer>
  )
}

const TopViewKey = 'AssistantsDrawer'

export default class AssistantsDrawer {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
