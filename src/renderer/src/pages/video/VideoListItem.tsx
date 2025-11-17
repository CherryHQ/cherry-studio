import { cn, Progress, Spinner } from '@heroui/react'
import { DeleteIcon } from '@renderer/components/Icons'
import type { Video } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { CheckCircleIcon, CircleXIcon, ClockIcon, DownloadIcon, ImageDownIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const VideoListItem = ({
  video,
  isActive,
  onClick,
  onDelete,
  onGetThhumbnail
}: {
  video: Video
  isActive: boolean
  onClick: () => void
  onDelete: () => void
  onGetThhumbnail: () => void
}) => {
  const { t } = useTranslation()

  const getStatusIcon = () => {
    switch (video.status) {
      case 'queued':
        return <ClockIcon size={20} className="text-default-500" />
      case 'in_progress':
        return <Spinner size="sm" color="primary" />
      case 'completed':
        return <CheckCircleIcon size={20} className="text-success" />
      case 'downloading':
        return <DownloadIcon size={20} className="text-primary" />
      case 'downloaded':
        return null // No indicator for downloaded state
      case 'failed':
        return <CircleXIcon size={20} className="text-danger" />
      default:
        return null
    }
  }

  const getStatusColor = () => {
    switch (video.status) {
      case 'queued':
        return 'bg-default-100'
      case 'in_progress':
        return 'bg-primary-50'
      case 'completed':
        return 'bg-success-50'
      case 'downloading':
        return 'bg-primary-50'
      case 'downloaded':
        return 'bg-success-50'
      case 'failed':
        return 'bg-danger-50'
      default:
        return 'bg-default-50'
    }
  }

  const getStatusLabel = () => {
    switch (video.status) {
      case 'queued':
        return t('video.status.queued')
      case 'in_progress':
        return t('video.status.in_progress')
      case 'completed':
        return t('video.status.completed')
      case 'downloading':
        return t('video.status.downloading')
      case 'downloaded':
        return ''
      case 'failed':
        return t('video.status.failed')
      default:
        return ''
    }
  }

  const showProgress = video.status === 'in_progress' || video.status === 'downloading'
  const showThumbnail =
    (video.status === 'completed' || video.status === 'downloading' || video.status === 'downloaded') &&
    video.thumbnail !== null

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className={cn(
            `group relative aspect-square cursor-pointer overflow-hidden rounded-xl border-2 transition-all hover:scale-105 hover:shadow-lg ${getStatusColor()}`,
            isActive ? 'border-primary' : undefined
          )}
          onClick={onClick}>
          {/* Thumbnail placeholder */}
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-default-100 to-default-200">
            {showThumbnail ? (
              <img src={video.thumbnail ?? ''} alt="Video thumbnail" className="h-full w-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-default-400">
                <div className="text-2xl">🎬</div>
              </div>
            )}
          </div>

          {/* Status overlay */}
          <div className="absolute inset-0 bg-black/20 opacity-0 transition-opacity group-hover:opacity-100" />

          {/* Status indicator */}
          {getStatusIcon() && (
            <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 backdrop-blur-sm">
              {getStatusIcon()}
              <span className="font-medium text-black text-xs">{getStatusLabel()}</span>
            </div>
          )}

          {/* Progress bar for in_progress and downloading states */}
          {showProgress && (
            <div className="absolute right-0 bottom-0 left-0 p-2">
              <Progress
                aria-label="progress bar"
                size="sm"
                value={video.progress}
                color={video.status === 'downloading' ? 'primary' : 'primary'}
                className="w-full"
                showValueLabel={false}
              />
            </div>
          )}

          {/* Video info overlay */}
          <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-6 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="text-white">
              <p className="truncate font-medium text-sm">{video.metadata.id}</p>
              {video.prompt && <p className="mt-1 line-clamp-2 text-xs opacity-80">{video.prompt}</p>}
            </div>
          </div>

          {/* Failed state overlay */}
          {video.status === 'failed' && (
            <div className="absolute inset-0 flex items-center justify-center bg-danger/10"></div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {video.thumbnail === null && (
          <ContextMenuItem onSelect={onGetThhumbnail}>
            <ImageDownIcon />
            <span>{t('video.thumbnail.get')}</span>
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={onDelete}>
          <DeleteIcon className="text-danger" />
          <span className="text-danger">{t('common.delete')}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
