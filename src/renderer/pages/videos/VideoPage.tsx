import { type FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useVideos } from '@renderer/hooks/useVideos'

const VideoPage: FC = () => {
  const { t } = useTranslation()
  const { videos } = useVideos()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b px-4 py-3">
        <h1 className="text-lg font-semibold">{t('title.videos')}</h1>
      </div>
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        {videos.length === 0 ? <span>{t('title.videos')}</span> : null}
      </div>
    </div>
  )
}

export default VideoPage
