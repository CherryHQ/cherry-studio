import { isLinux, isMac, isWindows } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { Button } from 'antd'
import { ChevronDown, X } from 'lucide-react'
import type { FC, PropsWithChildren } from 'react'
import type { HTMLAttributes } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

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
      <CloseIconWindows />
      {children}
      <CloseIconMac />
    </NavbarMainContainer>
  )
}

const CloseIconMac = () => {
  const navigate = useNavigate()

  if (!isMac) {
    return null
  }

  return <Button type="text" icon={<X size={18} />} onClick={() => navigate('/')} className="nodrag" />
}

const CloseIconWindows = () => {
  const navigate = useNavigate()

  if (isMac) {
    return null
  }

  return (
    <Button
      size="small"
      type="default"
      shape="circle"
      icon={<ChevronDown size={16} />}
      onClick={() => navigate('/')}
      className="nodrag"
      style={{ marginRight: 5 }}
    />
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
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '12px' : isWindows ? '140px' : isLinux ? '120px' : '12px')};
  justify-content: flex-end;
`

const NavbarMainContainer = styled.div<{ $isFullscreen: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  height: var(--navbar-height);
  max-height: var(--navbar-height);
  min-height: var(--navbar-height);
  justify-content: space-between;
  padding-left: ${isMac ? '70px' : '10px'};
  font-weight: bold;
  color: var(--color-text-1);
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '12px' : isWindows ? '140px' : isLinux ? '120px' : '12px')};
  -webkit-app-region: drag;
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
