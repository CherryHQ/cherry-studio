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
      {videos.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <span>{t('title.videos')}</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
          {videos.map((video) => (
            <div key={video.id} className="flex flex-col gap-1 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="truncate font-medium">{video.prompt}</span>
                <span className="text-muted-foreground text-xs">{video.status}</span>
              </div>
              {video.videoUrl ? (
                <video src={video.videoUrl} controls className="max-h-64 rounded-md" />
              ) : video.errorMessage ? (
                <span className="text-destructive text-xs">{video.errorMessage}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default VideoPage
