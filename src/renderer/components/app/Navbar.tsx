import { cn } from '@renderer/utils'
import type { FC, PropsWithChildren } from 'react'
import type { HTMLAttributes } from 'react'

type Props = PropsWithChildren & HTMLAttributes<HTMLDivElement>

export const Navbar: FC<Props> = () => null

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
  return <NavbarMainContainer {...props}>{children}</NavbarMainContainer>
}

export const NavbarHeader: FC<Props> = ({ children, ...props }) => {
  return <NavbarHeaderContent {...props}>{children}</NavbarHeaderContent>
}

const NavbarLeftContainer: FC<Props> = ({ className, ...props }) => (
  <div className={cn('flex flex-row items-center px-2.5 font-bold text-foreground', className)} {...props} />
)

const NavbarCenterContainer: FC<Props> = ({ className, ...props }) => (
  <div className={cn('relative flex flex-1 items-center pl-2.5 font-bold text-foreground', className)} {...props} />
)

const NavbarRightContainer: FC<Props> = ({ className, ...props }) => (
  <div className={cn('flex min-w-(--topic-list-width) flex-1 items-center justify-end px-3', className)} {...props} />
)

const NavbarMainContainer: FC<Props> = ({ className, ...props }) => (
  <div
    className={cn('flex flex-1 flex-row items-center justify-between pl-2.5 font-bold text-foreground', className)}
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
