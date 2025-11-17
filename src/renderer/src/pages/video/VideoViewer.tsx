import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  Progress,
  Skeleton,
  Spinner,
  useDisclosure
} from '@heroui/react'
import { usePending } from '@renderer/hooks/usePending'
import FileManager from '@renderer/services/FileManager'
import type { Video, VideoDownloaded, VideoFailed } from '@renderer/types'
import dayjs from 'dayjs'
import { CheckCircleIcon, CircleXIcon, Clock9Icon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

export type VideoViewerProps =
  | {
      video: undefined
      onDownload?: never
      onRegenerate?: never
    }
  | {
      video: Video
      onDownload: () => void
      onRegenerate: () => void
    }

export const VideoViewer = ({ video, onDownload, onRegenerate }: VideoViewerProps) => {
  const { t } = useTranslation()
  const [loadSuccess, setLoadSuccess] = useState<boolean | undefined>(undefined)
  const { pendingMap } = usePending()
  const isPending = video ? pendingMap[video.id] : false
  useEffect(() => {
    setLoadSuccess(undefined)
  }, [video?.id])
  return (
    <>
      <div className="flex h-full max-h-full w-full items-center justify-center rounded-2xl bg-foreground-200">
        {video === undefined && t('video.undefined')}
        {video && video.status === 'queued' && <QueuedVideo />}
        {video && video.status === 'in_progress' && <InProgressVideo progress={video.progress} />}
        {video && video.status === 'completed' && (
          <CompletedVideo video={video} isDisabled={isPending} onDownload={onDownload} onRegenerate={onRegenerate} />
        )}
        {video && video.status === 'downloading' && <DownloadingVideo progress={video.progress} />}
        {video && video.status === 'downloaded' && loadSuccess !== false && (
          <VideoPlayer video={video} setLoadSuccess={setLoadSuccess} />
        )}
        {video && video.status === 'failed' && <FailedVideo error={video.error} />}
        {video && video.status === 'downloaded' && loadSuccess === false && (
          <LoadFailedVideo isDisabled={isPending} onRedownload={onDownload} />
        )}
      </div>
    </>
  )
}

const QueuedVideo = () => {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl">
      <Spinner variant="dots" />
      <span>{t('video.status.queued')}</span>
    </div>
  )
}

const InProgressVideo = ({ progress }: { progress: number }) => {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl">
      <Progress
        label={t('video.status.in_progress')}
        aria-label={t('video.status.in_progress')}
        className="max-w-md"
        color="primary"
        showValueLabel={true}
        size="md"
        value={progress}
      />
    </div>
  )
}

const CompletedVideo = ({
  video,
  isDisabled,
  onDownload,
  onRegenerate
}: {
  video: Video
  isDisabled?: boolean
  onDownload: () => void
  onRegenerate: () => void
}) => {
  const { t } = useTranslation()
  const isExpired = video.metadata.expires_at !== null && video.metadata.expires_at < dayjs().unix()
  if (isExpired) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl bg-warning-200">
        <Clock9Icon size={64} className="text-warning" />
        <span className="font-bold text-2xl">{t('video.expired')}</span>
        <Button onPress={onRegenerate} isDisabled={isDisabled}>
          {t('common.regenerate')}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl bg-success-200">
      <CheckCircleIcon size={64} className="text-success" />
      <span className="font-bold text-2xl">{t('video.status.completed')}</span>
      <Button onPress={onDownload} isDisabled={isDisabled}>
        {t('common.download')}
      </Button>
    </div>
  )
}

const DownloadingVideo = ({ progress }: { progress?: number }) => {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl">
      <Progress
        label={t('video.status.downloading')}
        aria-label={t('video.status.downloading')}
        className="max-w-md"
        color="primary"
        showValueLabel={true}
        size="md"
        value={progress}
      />
    </div>
  )
}

const FailedVideo = ({ error }: { error: VideoFailed['error'] }) => {
  const { t } = useTranslation()
  const { isOpen, onOpen, onClose } = useDisclosure()

  const alert = useMemo(() => {
    if (error === null) {
      return <Alert color="danger" title={t('error.unknown')} />
    } else {
      return <Alert color="danger" title={error.code} description={error.message} />
    }
  }, [error, t])

  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-danger-200">
      <CircleXIcon size={64} className="fill-danger text-danger-200" />
      <span className="font-bold text-2xl">{t('video.status.failed')}</span>
      <div className="my-2 flex justify-between gap-2">
        <Button onPress={onOpen}>{t('common.detail')}</Button>
        <Modal isOpen={isOpen} onClose={onClose}>
          <ModalBody>
            <ModalContent>
              <div className="p-4">{alert}</div>
            </ModalContent>
          </ModalBody>
          <ModalFooter></ModalFooter>
        </Modal>
        <Button onPress={() => window.toast.info('Not implemented')}>{t('common.retry')}</Button>
      </div>
    </div>
  )
}

const LoadFailedVideo = ({ isDisabled, onRedownload }: { isDisabled?: boolean; onRedownload: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-danger-200">
      <CircleXIcon size={64} className="fill-danger text-danger-200" />
      <span className="font-bold text-2xl">{t('video.error.load.message')}</span>
      <span>{t('video.error.load.reason')}</span>
      <div className="my-2 flex justify-between gap-2">
        <Button onPress={onRedownload} isDisabled={isDisabled}>
          {t('common.redownload')}
        </Button>
      </div>
    </div>
  )
}

const VideoPlayer = ({
  video,
  setLoadSuccess
}: {
  video: VideoDownloaded
  setLoadSuccess: (value: boolean) => void
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fetcher = async () => {
    const file = await FileManager.getFile(video.fileId)
    if (!file) {
      throw new Error(`Video file ${video.fileId} not exist.`)
    }
    return FileManager.getFilePath(file)
  }
  const { data: src, isLoading, error } = useSWRImmutable(`video/file/${video.id}`, fetcher)

  useEffect(() => {
    const videoElement = videoRef.current
    if (videoElement) {
      videoElement.load()
    }
  }, [video?.id])

  if (error) {
    setLoadSuccess(false)
  }

  if (isLoading) {
    return <Skeleton />
  }

  return (
    <video
      ref={videoRef}
      controls
      className="h-full w-full rounded-2xl bg-content2 object-contain dark:bg-background"
      onLoadedData={() => setLoadSuccess(true)}
      onError={() => setLoadSuccess(false)}>
      <source src={`file://${src}`} type="video/mp4" />
    </video>
  )
}
