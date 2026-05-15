import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { cn } from '@renderer/utils'
import type { FC, PropsWithChildren } from 'react'
import type { HTMLAttributes } from 'react'

import WindowControls from '../WindowControls'

type Props = PropsWithChildren & HTMLAttributes<HTMLDivElement>

export const Navbar: FC<Props> = ({ children, ...props }) => {
  const backgroundColor = useNavBackgroundColor()
  const isFullscreen = useFullscreen()
  const { isTopNavbar } = useNavbarPosition()
  const { miniAppShow } = useMiniApps()

  if (isTopNavbar) {
    return null
  }

  return (
    <NavbarContainer {...props} style={{ ...props.style, backgroundColor }} isFullScreen={isFullscreen}>
      {children}
      {!miniAppShow && <WindowControls />}
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
  return <NavbarRightContainer {...props}>{children}</NavbarRightContainer>
}

export const NavbarMain: FC<Props> = ({ children, ...props }) => {
  const isFullscreen = useFullscreen()
  return (
    <NavbarMainContainer {...props} isFullscreen={isFullscreen}>
      {children}
    </NavbarMainContainer>
  )
}

export const NavbarHeader: FC<Props> = ({ children, ...props }) => {
  return <NavbarHeaderContent {...props}>{children}</NavbarHeaderContent>
}

const NavbarContainer: FC<Props & { isFullScreen: boolean }> = ({ isFullScreen, className, style, ...props }) => (
  <div
    className={cn('flex min-w-full flex-row [-webkit-app-region:drag]', className)}
    style={{
      minHeight: !isFullScreen && isMac ? 'env(titlebar-area-height)' : 'var(--navbar-height)',
      maxHeight: 'var(--navbar-height)',
      marginLeft: isMac ? 'calc(var(--sidebar-width) * -1 + 2px)' : 0,
      paddingLeft: isMac ? (isFullScreen ? 'var(--sidebar-width)' : 'env(titlebar-area-x)') : 0,
      ...style
    }}
    {...props}
  />
)

const NavbarLeftContainer: FC<Props> = ({ className, ...props }) => (
  <div className={cn('flex flex-row items-center px-2.5 font-bold text-foreground', className)} {...props} />
)

const NavbarCenterContainer: FC<Props> = ({ className, style, ...props }) => (
  <div
    className={cn('relative flex flex-1 items-center pl-2.5 font-bold text-foreground', className)}
    style={{ paddingRight: isMac ? '20px' : 0, ...style }}
    {...props}
  />
)

const NavbarRightContainer: FC<Props> = ({ className, ...props }) => (
  <div className={cn('flex min-w-(--topic-list-width) flex-1 items-center justify-end px-3', className)} {...props} />
)

const NavbarMainContainer: FC<Props & { isFullscreen: boolean }> = ({ isFullscreen, className, style, ...props }) => (
  <div
    className={cn('flex flex-1 flex-row items-center justify-between pl-2.5 font-bold text-foreground', className)}
    style={{
      paddingRight: isFullscreen ? '12px' : isWin ? '140px' : isLinux ? '120px' : '12px',
      ...style
    }}
    {...props}
  />
)

const NavbarHeaderContent: FC<Props> = ({ className, ...props }) => (
  <div
    className={cn(
      'flex max-h-(--navbar-height) min-h-(--navbar-height) flex-1 flex-row items-center justify-between px-3',
      className
    )}
    {...props}
  />
)
