import { Center } from '@renderer/components/Layout'
import { getAllMinApps } from '@renderer/config/minapps'
import App from '@renderer/pages/apps/App'
import { Popover } from 'antd'
import { Empty } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import styled from 'styled-components'

import Scrollbar from '../Scrollbar'

interface Props {
  children: React.ReactNode
}

const AppStorePopover: FC<Props> = ({ children }) => {
  const [open, setOpen] = useState(false)
  const apps = getAllMinApps()

  useHotkeys('esc', () => {
    setOpen(false)
  })

  const handleClose = () => {
    setOpen(false)
  }

  const content = (
    <PopoverContent>
      <AppsContainer>
        {apps.map((app) => (
          <App key={app.id} app={app} onClick={handleClose} size={50} />
        ))}
        {isEmpty(apps) && (
          <Center>
            <Empty />
          </Center>
        )}
      </AppsContainer>
    </PopoverContent>
  )

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      content={content}
      trigger="click"
      placement="bottomRight"
      styles={{ body: { padding: 25 } }}>
      {children}
    </Popover>
  )
}

const PopoverContent = styled(Scrollbar)``

const AppsContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(90px, 1fr));
  gap: 18px;
`

export default AppStorePopover
