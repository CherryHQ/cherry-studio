import { Button, cn, Image, Skeleton, Textarea, Tooltip } from '@heroui/react'
import { loggerService } from '@logger'
import { usePending } from '@renderer/hooks/usePending'
import { useAddOpenAIVideo } from '@renderer/hooks/video/useAddOpenAIVideo'
import { useProviderVideos } from '@renderer/hooks/video/useProviderVideos'
import { createVideo, retrieveVideoContent } from '@renderer/services/ApiService'
import FileManager from '@renderer/services/FileManager'
import type { CreateVideoParams, Provider, Video, VideoFileMetadata } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { MB } from '@shared/config/constant'
import type { DeepPartial } from 'ai'
import dayjs from 'dayjs'
import { isEmpty } from 'lodash'
import { ArrowUp, CircleXIcon, ImageIcon } from 'lucide-react'
import mime from 'mime-types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { VideoViewer } from './VideoViewer'

export type VideoPanelProps = {
  provider: Provider
  video?: Video
  params: CreateVideoParams
  updateParams: (upadte: DeepPartial<Omit<CreateVideoParams, 'type'>>) => void
  setActiveVideoId: (id: string) => void
}

const logger = loggerService.withContext('VideoPanel')

export const VideoPanel = ({ provider, video, params, updateParams, setActiveVideoId }: VideoPanelProps) => {
  const { t } = useTranslation()
  const addOpenAIVideo = useAddOpenAIVideo(provider.id)
  const { setVideo } = useProviderVideos(provider.id)

  const { pendingMap, setPending: setPendingById } = usePending()
  const [isProcessing, setIsProcessing] = useState<boolean | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputReference = params.params.input_reference

  const couldCreateVideo = useMemo(
    () =>
      !isEmpty(params.params.prompt) &&
      video?.status !== 'queued' &&
      video?.status !== 'downloading' &&
      video?.status !== 'in_progress' &&
      (video === undefined || pendingMap[video.id] !== true),
    [params.params.prompt, pendingMap, video]
  )

  useEffect(() => {
    if (video) {
      updateParams({ params: { prompt: video.prompt } })
    } else {
      updateParams({ params: { prompt: '' } })
    }
  }, [updateParams, video])

  const isPending = (video ? pendingMap[video.id] : false) || isProcessing
  const setPending = useCallback(
    (value: boolean) => {
      if (video) {
        setPendingById(video.id, value ? value : undefined)
      } else {
        setIsProcessing(value)
      }
    },
    [setPendingById, video]
  )

  const handleCreateVideo = useCallback(async () => {
    if (!couldCreateVideo) return
    setPending(true)
    try {
      if (video === undefined) {
        const result = await createVideo(params)
        const video = result.video
        switch (result.type) {
          case 'openai':
            addOpenAIVideo(video, params.params.prompt)
            break
          default:
            logger.error(`Invalid video type ${result.type}.`)
        }
        setActiveVideoId(result.video.id)
      } else {
        // TODO: remix video
        window.toast.info('Remix video is not implemented.')
      }
    } catch (e) {
      window.toast.error({ title: t('video.error.create'), description: getErrorMessage(e), timeout: 5000 })
    } finally {
      setPending(false)
    }
  }, [addOpenAIVideo, couldCreateVideo, params, setPending, t, video])

  const handleRegenerateVideo = useCallback(() => {
    window.toast.info('Not implemented')
  }, [])

  const handleDownloadVideo = useCallback(async () => {
    if (!video) return
    if (video.status !== 'completed' && video.status !== 'downloaded') return

    const baseVideo: Video = {
      ...video,
      status: 'downloading',
      progress: 0,
      thumbnail: video.thumbnail
    }
    setVideo(baseVideo)

    try {
      const { response } = await retrieveVideoContent({ type: 'openai', videoId: video.id, provider })
      if (!response.body) {
        throw new Error('Video response body is empty')
      }

      const reader = response.body.getReader()
      const contentLengthHeader = response.headers.get('content-length')
      const totalSize = contentLengthHeader ? Number(contentLengthHeader) : undefined
      const chunks: Uint8Array[] = []
      let receivedLength = 0
      let progressValue = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue

        chunks.push(value)
        receivedLength += value.length

        if (totalSize && Number.isFinite(totalSize) && totalSize > 0) {
          progressValue = Math.floor((receivedLength / totalSize) * 100)
        } else {
          progressValue = Math.min(progressValue + 1, 99)
        }

        setVideo({
          ...baseVideo,
          progress: Math.min(progressValue, 99)
        })
      }

      const fileData = new Uint8Array(receivedLength)
      let offset = 0
      for (const chunk of chunks) {
        fileData.set(chunk, offset)
        offset += chunk.length
      }

      const contentType = response.headers.get('content-type') ?? 'video/mp4'
      const normalizedContentType = contentType.split(';')[0]?.trim() || 'video/mp4'
      const extension = (() => {
        const ext = mime.extension(normalizedContentType)
        return ext ? `.${ext}` : '.mp4'
      })()

      const fileName = `${video.id}${extension}`.toLowerCase()

      const tempFilePath = await window.api.file.createTempFile(fileName)
      await window.api.file.write(tempFilePath, fileData)

      const tempFileMetadata = {
        id: crypto.randomUUID(),
        name: fileName,
        origin_name: fileName,
        path: tempFilePath,
        size: receivedLength,
        ext: extension,
        type: FileTypes.VIDEO,
        created_at: dayjs().toISOString(),
        count: 1
      } satisfies VideoFileMetadata

      const uploadedFile = await FileManager.uploadFile(tempFileMetadata)

      setVideo({
        ...video,
        status: 'downloaded',
        thumbnail: video.thumbnail,
        fileId: uploadedFile.id,
        name: uploadedFile.origin_name
      })
    } catch (error) {
      logger.error(`Failed to download video ${video.id}.`, error as Error)
      window.toast.error(t('video.error.download'))
      setVideo(video)
    }
  }, [provider, setVideo, t, video])

  const handleUploadFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const setPrompt = useCallback((value: string) => updateParams({ params: { prompt: value } }), [updateParams])

  const UploadImageReferenceButton = useCallback(() => {
    const content = inputReference ? (
      <div className="group">
        <Image
          className="aspect-square max-h-50 max-w-50 object-contain"
          src={URL.createObjectURL(inputReference as File)}
        />
        <Button
          variant="light"
          color="danger"
          className="absolute top-1 right-1 z-100 h-6 w-6 min-w-0 opacity-0 group-hover:opacity-100"
          isIconOnly
          startContent={<CircleXIcon size={16} className="text-danger" />}
          onPress={() => updateParams({ params: { input_reference: undefined } })}
        />
      </div>
    ) : (
      t('video.input_reference.add.tooltip')
    )
    return (
      <>
        <Tooltip content={content} closeDelay={0}>
          <Button
            variant="light"
            startContent={<ImageIcon size={16} className={cn(inputReference ? 'text-primary' : undefined)} />}
            isIconOnly
            className="h-6 w-6 min-w-0"
            isDisabled={isPending}
            onPress={handleUploadFile}
          />
        </Tooltip>
      </>
    )
  }, [handleUploadFile, inputReference, isPending, t, updateParams])

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-2">
      <div className="m-8 flex-1 overflow-hidden">
        <Skeleton className="h-full w-full rounded-2xl" classNames={{ content: 'h-full w-full' }} isLoaded={true}>
          {video && <VideoViewer video={video} onDownload={handleDownloadVideo} onRegenerate={handleRegenerateVideo} />}
          {!video && <VideoViewer video={video} />}
        </Skeleton>
      </div>
      <div className="relative">
        <Textarea
          label={t('common.prompt')}
          placeholder={t('video.prompt.placeholder')}
          value={params.params.prompt}
          onValueChange={setPrompt}
          isClearable
          isDisabled={isPending}
          classNames={{ inputWrapper: 'pb-8' }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleCreateVideo()
            }
          }}
        />
        <div className="absolute bottom-0 flex w-full items-end justify-between p-2">
          <div className="flex">
            <UploadImageReferenceButton />
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={(e) => {
                const files = e.target.files
                if (files && files.length > 0) {
                  const file = files[0]
                  if (!file.type.startsWith('image/')) {
                    window.toast.error(t('video.input_reference.add.error.format'))
                    return
                  }
                  const maxSize = 5 * MB
                  if (file.size > maxSize) {
                    window.toast.error(t('video.input_reference.add.error.size'))
                    return
                  }
                  updateParams({ params: { input_reference: file } })
                } else {
                  updateParams({ params: { input_reference: undefined } })
                }
              }}
            />
          </div>

          <Tooltip content={t('common.send')} closeDelay={0}>
            <Button
              color="primary"
              radius="full"
              isIconOnly
              isDisabled={!couldCreateVideo}
              isLoading={isPending}
              className="h-6 w-6 min-w-0"
              onPress={handleCreateVideo}>
              <ArrowUp size={16} className="text-primary-foreground" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
