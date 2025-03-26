import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import MinApp from '@renderer/components/MinApp'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { MinAppType } from '@renderer/types'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  onClick?: () => void
  size?: number
}

const App: FC<Props> = ({ app, onClick, size = 60 }) => {
  const { t } = useTranslation()
  const { minapps, pinned, disabled, updateMinapps, updateDisabledMinapps, updatePinnedMinapps } = useMinapps()
  const isPinned = pinned.some((p) => p.id === app.id)
  const isVisible = minapps.some((m) => m.id === app.id)

  const handleClick = () => {
    MinApp.start(app)
    onClick?.()
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'togglePin',
      label: isPinned ? t('minapp.sidebar.remove.title') : t('minapp.sidebar.add.title'),
      onClick: () => {
        const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...(pinned || []), app]
        updatePinnedMinapps(newPinned)
      }
    },
    {
      key: 'hide',
      label: t('minapp.sidebar.hide.title'),
      onClick: () => {
        const newMinapps = minapps.filter((item) => item.id !== app.id)
        updateMinapps(newMinapps)
        const newDisabled = [...(disabled || []), app]
        updateDisabledMinapps(newDisabled)
        const newPinned = pinned.filter((item) => item.id !== app.id)
        updatePinnedMinapps(newPinned)
      }
    }
  ]

  if (!isVisible) return null

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <Container onClick={handleClick}>
        <MinAppIcon size={size} app={app} />
        <AppTitle>{app.name}</AppTitle>
      </Container>
    </Dropdown>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

export default App
