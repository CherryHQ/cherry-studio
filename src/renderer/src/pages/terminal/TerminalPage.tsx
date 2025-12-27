import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

export const TerminalPage: FC = () => {
  // const { pathname } = useLocation()
  const { t } = useTranslation()

  // const isRoute = (path: string): string => (pathname.startsWith(path) ? 'active' : '')

  return (
    <div>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('title.terminal')}</NavbarCenter>
      </Navbar>
      <div>🥲 Not Implemented</div>
    </div>
  )
}
