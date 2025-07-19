import { useTheme } from '@renderer/context/ThemeProvider'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import type { MenuProps } from 'antd'
import { Dropdown, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { DraggableList } from '../DraggableList'
import MinAppIcon from '../Icons/MinAppIcon'

const PinnedApps: FC = () => {
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { t } = useTranslation()
  const { minappShow, openedKeepAliveMinapps, currentMinappId } = useRuntime()
  const { theme } = useTheme()
  const { openMinappKeepAlive } = useMinappPopup()

  return (
    <DraggableList list={pinned} onUpdate={updatePinnedMinapps} listStyle={{ marginBottom: 5 }}>
      {(app) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'togglePin',
            label: t('minapp.sidebar.remove.title'),
            onClick: () => {
              const newPinned = pinned.filter((item) => item.id !== app.id)
              updatePinnedMinapps(newPinned)
            }
          }
        ]
        const isActive = minappShow && currentMinappId === app.id
        return (
          <Tooltip key={app.id} title={app.name} mouseEnterDelay={0.8} placement="right">
            <StyledLink>
              <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} overlayStyle={{ zIndex: 10000 }}>
                <Icon
                  theme={theme}
                  onClick={() => openMinappKeepAlive(app)}
                  className={`${isActive ? 'active' : ''} ${openedKeepAliveMinapps.some((item) => item.id === app.id) ? 'opened-minapp' : ''}`}>
                  <MinAppIcon size={20} app={app} style={{ borderRadius: 6 }} sidebar />
                </Icon>
              </Dropdown>
            </StyledLink>
          </Tooltip>
        )
      }}
    </DraggableList>
  )
}

const Icon = styled.div<{ theme: string }>`
  width: 35px;
  height: 35px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  box-sizing: border-box;
  -webkit-app-region: none;
  border: 0.5px solid transparent;
  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    opacity: 0.8;
    cursor: pointer;
    .icon {
      color: var(--color-icon-white);
    }
  }
  &.active {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    border: 0.5px solid var(--color-border);
    .icon {
      color: var(--color-primary);
    }
  }

  @keyframes borderBreath {
    0% {
      opacity: 0.1;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.1;
    }
  }

  &.opened-minapp {
    position: relative;
  }
  &.opened-minapp::after {
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    border-radius: inherit;
    opacity: 0.3;
    border: 0.5px solid var(--color-primary);
  }
`

const StyledLink = styled.div`
  text-decoration: none;
  -webkit-app-region: none;
  &* {
    user-select: none;
  }
`

export default PinnedApps
