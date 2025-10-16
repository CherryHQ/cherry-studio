// interface VideoPageProps {}

import { Divider } from '@heroui/react'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { usePending } from '@renderer/hooks/usePending'
import { useProvider } from '@renderer/hooks/useProvider'
import { useProviderVideos } from '@renderer/hooks/video/useProviderVideos'
import { useVideoThumbnail } from '@renderer/hooks/video/useVideoThumbnail'
import { deleteVideo } from '@renderer/services/ApiService'
import type { CreateVideoParams } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { deepUpdate } from '@renderer/utils/deepUpdate'
import { isVideoModel } from '@renderer/utils/model/video'
import type { DeepPartial } from 'ai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelSetting } from './settings/ModelSetting'
import { OpenAIParamSettings } from './settings/OpenAIParamSettings'
import { ProviderSetting } from './settings/ProviderSetting'
import { SettingsGroup } from './settings/shared'
import { VideoList } from './VideoList'
import { VideoPanel } from './VideoPanel'

export const VideoPage = () => {
  const { t } = useTranslation()
  const [providerId, setProviderId] = useState<string>(SystemProviderIds.openai)
  const { provider } = useProvider(providerId)
  const [params, setParams] = useState<CreateVideoParams>({
    type: 'openai',
    provider,
    params: {
      model: 'sora-2',
      prompt: ''
    },
    options: {}
  })
  const { videos, removeVideo, getVideo, updateVideo } = useProviderVideos(providerId)
  // const activeVideo = useMemo(() => mockVideos.find((v) => v.id === activeVideoId), [activeVideoId])
  const [activeVideoId, setActiveVideoId] = useState<string>()
  const activeVideo = useMemo(() => videos.find((v) => v.id === activeVideoId), [activeVideoId, videos])
  const { setPending } = usePending()
  const { removeThumbnail, retrieveThumbnail } = useVideoThumbnail()

  const updateParams = useCallback((update: DeepPartial<Omit<CreateVideoParams, 'type'>>) => {
    setParams((prev) => deepUpdate<CreateVideoParams>(prev, update))
  }, [])

  const updateModelId = useCallback(
    (id: string) => {
      if (isVideoModel(id)) {
        updateParams({ params: { model: id } })
      }
    },
    [updateParams]
  )

  const afterDeleteVideo = useCallback(
    (id: string) => {
      removeVideo(id)
      removeThumbnail(id)
    },
    [removeThumbnail, removeVideo]
  )

  const handleDeleteVideo = useCallback(
    async (id: string) => {
      switch (provider.type) {
        case 'openai-response':
          try {
            setPending(id, true)
            const promise = deleteVideo({
              type: 'openai',
              videoId: id,
              provider
            })
            window.toast.loading({
              title: t('common.deleting'),
              promise
            })
            const result = await promise
            if (result.result.deleted) {
              afterDeleteVideo(id)
            } else {
              window.toast.error(t('error.delete.failed'))
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes('404')) {
              window.toast.warning({
                title: t('video.delete.error.not_found.title'),
                description: t('video.delete.error.not_found.description')
              })
              afterDeleteVideo(id)
            } else {
              window.toast.error({ title: t('error.delete.failed'), description: getErrorMessage(e) })
            }
          } finally {
            setPending(id, undefined)
          }
          break
        default:
          throw new Error(`Provider type "${provider.type}" is not supported for video deletion`)
      }
    },
    [afterDeleteVideo, provider, setPending, t]
  )

  const handleGetThumbnail = useCallback(
    async (id: string) => {
      const video = getVideo(id)
      if (video && video.thumbnail === null) {
        try {
          const promise = retrieveThumbnail(video)
          window.toast.loading({ title: t('video.thumbnail.get'), promise })
          const thumbnail = await promise
          if (thumbnail) {
            updateVideo({ id: video.id, thumbnail })
          }
        } catch (e) {
          window.toast.error({ title: t('video.thumbnail.error.get'), description: getErrorMessage(e) })
        }
      }
    },
    [getVideo, retrieveThumbnail, t, updateVideo]
  )

  return (
    <div className="flex flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('video.title')}</NavbarCenter>
      </Navbar>
      <div id="content-container" className="flex flex-1 overflow-hidden">
        {/* Settings */}
        <div className="flex w-70 flex-col p-2">
          <SettingsGroup>
            <ProviderSetting providerId={providerId} setProviderId={setProviderId} />
            <ModelSetting
              providerId={providerId}
              modelId={params.params.model ?? 'sora-2'}
              setModelId={updateModelId}
            />
          </SettingsGroup>
          {provider.type === 'openai-response' && <OpenAIParamSettings params={params} updateParams={updateParams} />}
        </div>
        <Divider orientation="vertical" />
        <VideoPanel
          provider={provider}
          params={params}
          updateParams={updateParams}
          setActiveVideoId={setActiveVideoId}
          video={activeVideo}
        />
        <Divider orientation="vertical" />
        {/* Video list */}
        <VideoList
          videos={videos}
          activeVideoId={activeVideoId}
          setActiveVideoId={setActiveVideoId}
          onDelete={handleDeleteVideo}
          onGetThumbnail={handleGetThumbnail}
        />
      </div>
    </div>
  )
}
