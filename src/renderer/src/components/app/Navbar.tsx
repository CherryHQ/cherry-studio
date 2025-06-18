import { isLinux, isWindows } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { Button } from 'antd'
import type { FC, PropsWithChildren } from 'react'
import type { HTMLAttributes } from 'react'
import styled, { keyframes } from 'styled-components'

type Props = PropsWithChildren & HTMLAttributes<HTMLDivElement>

export const Navbar: FC<Props> = ({ children, ...props }) => {
  return <NavbarContainer {...props}>{children}</NavbarContainer>
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

const NavbarContainer = styled.div`
  min-width: 100%;
  display: flex;
  flex-direction: row;
  min-height: var(--navbar-height);
  max-height: var(--navbar-height);
  -webkit-app-region: drag;
  background-color: var(--color-background);
`

const NavbarRightContainer = styled.div<{ $isFullscreen: boolean }>`
  min-width: var(--topic-list-width);
  display: flex;
  align-items: center;
  padding: 0 12px;
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '12px' : isWindows ? '135px' : isLinux ? '120px' : '12px')};
  justify-content: flex-end;
`

const NavbarMainContainer = styled.div<{ $isFullscreen: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: var(--color-background);
  height: var(--navbar-height);
  max-height: var(--navbar-height);
  min-height: var(--navbar-height);
  justify-content: space-between;
  font-weight: bold;
  color: var(--color-text-1);
  -webkit-app-region: drag;
  padding: 0 12px;
`

const NavbarCenterContainer = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  height: var(--navbar-height);
  max-height: var(--navbar-height);
  min-height: var(--navbar-height);
  padding: 0 8px;
  font-weight: bold;
  justify-content: space-between;
  color: var(--color-text-1);
`

const rotateAnimation = keyframes`
  from {
    transform: rotate(-180deg);
  }
  to {
    transform: rotate(0);
  }
`

const AnimatedButton = styled(Button)`
  animation: ${rotateAnimation} 0.4s ease-out;
`
