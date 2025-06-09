import { Assistant } from '@renderer/types'
import { Popover } from 'antd'
import { SlidersHorizontal } from 'lucide-react'
import { FC } from 'react'

import SettingsTab from '../Tabs/SettingsTab'

interface Props {
  assistant: Assistant
  ToolbarButton: any
}

const SettingButton: FC<Props> = ({ ToolbarButton }) => {
  return (
    <Popover
      placement="topLeft"
      content={<SettingsTab />}
      trigger="click"
      styles={{
        body: {
          padding: '4px 2px 4px 2px'
        }
      }}>
      <ToolbarButton type="text">
        <SlidersHorizontal size={16} />
      </ToolbarButton>
    </Popover>
  )
}

export default SettingButton
