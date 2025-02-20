import { Center } from '@renderer/components/Layout'
import { useMinapps } from '@renderer/hooks/useMinapps'
import App from '@renderer/pages/apps/App'
import { Popover } from 'antd'
import { Empty } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import styled from 'styled-components'

import Scrollbar from '../Scrollbar'

interface Props {
  children: React.ReactNode
}

const MinAppsPopover: FC<Props> = ({ children }) => {
  const [open, setOpen] = useState(false)
  const { minapps } = useMinapps()

  useHotkeys('esc', () => {
    setOpen(false)
  })

  const handleClose = () => {
    setOpen(false)
  }

  const [maxHeight, setMaxHeight] = useState(window.innerHeight - 100)

  useEffect(() => {
    const handleResize = () => {
      setMaxHeight(window.innerHeight - 100)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const content = (
    <PopoverContent maxHeight={maxHeight}>
      <AppsContainer>
        {minapps.map((app) => (
          <App key={app.id} app={app} onClick={handleClose} size={50} />
        ))}
        {isEmpty(minapps) && (
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

const PopoverContent = styled(Scrollbar)<{ maxHeight: number }>`
  max-height: ${(props) => props.maxHeight}px;
  overflow-y: auto;
`

const AppsContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(90px, 1fr));
  gap: 18px;
`

export default MinAppsPopover
