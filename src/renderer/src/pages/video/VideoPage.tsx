// interface VideoPageProps {}

import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { useTranslation } from 'react-i18next'

export const VideoPage = () => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('video.title')}</NavbarCenter>
      </Navbar>
      <div className="flex flex-1">video page</div>
    </div>
  )
}
