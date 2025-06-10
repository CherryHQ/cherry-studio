import { Assistant } from '@renderer/types'
import { Popover } from 'antd'
import { Settings } from 'lucide-react'
import { FC, useState } from 'react'

import SettingsTab from '../Tabs/SettingsTab'

interface Props {
  assistant: Assistant
  ToolbarButton: any
}

const SettingButton: FC<Props> = ({ assistant, ToolbarButton }) => {
  const [open, setOpen] = useState(false)

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
  }

  const handleClose = () => {
    setOpen(false)
  }

  return (
    <Popover
      placement="topLeft"
      content={<SettingsTab assistant={assistant} onClose={handleClose} />}
      trigger="click"
      open={open}
      onOpenChange={handleOpenChange}
      styles={{
        body: {
          padding: '4px 2px 4px 2px'
        }
      }}>
      <ToolbarButton type="text">
        <Settings size={18} />
      </ToolbarButton>
    </Popover>
  )
}

export default SettingButton
