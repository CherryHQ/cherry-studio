import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import type { FC, PropsWithChildren } from 'react'
import type { HTMLAttributes } from 'react'
import styled from 'styled-components'

type Props = PropsWithChildren & HTMLAttributes<HTMLDivElement>

export const Navbar: FC<Props> = ({ children, ...props }) => {
  const backgroundColor = useNavBackgroundColor()
  const { isTopNavbar } = useNavbarPosition()

  if (isTopNavbar) {
    return null
  }

  return (
    <NavbarContainer {...props} style={{ backgroundColor }}>
      {children}
    </NavbarContainer>
  )
}

export const NavbarLeft: FC<Props> = ({ children, ...props }) => {
  return <NavbarLeftContainer {...props}>{children}</NavbarLeftContainer>
}

export const NavbarCenter: FC<Props> = ({ children, ...props }) => {
  return <NavbarCenterContainer {...props}>{children}</NavbarCenterContainer>
}

export const NavbarRight: FC<Props> = ({ children, ...props }) => {
  const isFullscreen = useFullscreen()
  return (
    <NavbarRightContainer {...props} $isFullscreen={isFullscreen}>
      {children}
    </NavbarRightContainer>
  )
}

export const NavbarMain: FC<Props> = ({ children, ...props }) => {
  const isFullscreen = useFullscreen()
  return (
    <NavbarMainContainer {...props} $isFullscreen={isFullscreen}>
      {children}
    </NavbarMainContainer>
  )
}

export const NavbarHeader: FC<Props> = ({ children, ...props }) => {
  return <NavbarHeaderContent {...props}>{children}</NavbarHeaderContent>
}

const NavbarContainer = styled.div`
  min-width: 100%;
  display: flex;
  flex-direction: row;
  min-height: var(--navbar-height);
  max-height: var(--navbar-height);
  margin-left: ${isMac ? 'calc(var(--sidebar-width) * -1)' : 0};
  padding-left: ${isMac ? 'var(--sidebar-width)' : 0};
  -webkit-app-region: drag;
`

const NavbarLeftContainer = styled.div`
  min-width: var(--assistants-width);
  padding: 0 10px;
  display: flex;
  flex-direction: row;
  align-items: center;
  font-weight: bold;
  color: var(--color-text-1);
`

const NavbarCenterContainer = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  padding: 0 ${isMac ? '20px' : 0};
  font-weight: bold;
  color: var(--color-text-1);
`

const NavbarRightContainer = styled.div<{ $isFullscreen: boolean }>`
  min-width: var(--topic-list-width);
  display: flex;
  align-items: center;
  padding: 0 12px;
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '12px' : isWin ? '140px' : isLinux ? '120px' : '12px')};
  justify-content: flex-end;
`

const NavbarMainContainer = styled.div<{ $isFullscreen: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 ${isMac ? '20px' : 0};
  font-weight: bold;
  color: var(--color-text-1);
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '12px' : isWin ? '140px' : isLinux ? '120px' : '12px')};
`

const NavbarHeaderContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  min-height: var(--navbar-height);
  max-height: var(--navbar-height);
`
