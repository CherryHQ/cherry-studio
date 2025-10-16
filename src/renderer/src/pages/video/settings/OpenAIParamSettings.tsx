import type { VideoSeconds, VideoSize } from '@cherrystudio/openai/resources'
import { Select, SelectItem } from '@heroui/react'
import type { OpenAICreateVideoParams } from '@renderer/types'
import type { DeepPartial } from 'ai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingItem, SettingsGroup } from './shared'

export type OpenAIParamSettingsProps = {
  params: OpenAICreateVideoParams
  updateParams: (update: DeepPartial<Omit<OpenAICreateVideoParams, 'type'>>) => void
}

export const OpenAIParamSettings = ({ params, updateParams }: OpenAIParamSettingsProps) => {
  const { t } = useTranslation()

  const secondItems = [{ key: '4' }, { key: '8' }, { key: '12' }] as const satisfies { key: VideoSeconds }[]
  const sizeItems = [
    { key: '720x1280' },
    { key: '1280x720' },
    { key: '1024x1792' },
    { key: '1792x1024' }
  ] as const satisfies { key: VideoSize }[]

  const updateSeconds = useCallback(
    (seconds: VideoSeconds) => {
      updateParams({ params: { seconds } })
    },
    [updateParams]
  )

  const updateSize = useCallback(
    (size: VideoSize) => {
      updateParams({ params: { size } })
    },
    [updateParams]
  )

  return (
    <SettingsGroup>
      <SettingItem>
        <Select
          label={t('video.seconds')}
          labelPlacement="outside"
          selectedKeys={[params.params.seconds ?? '4']}
          onSelectionChange={(keys) => {
            if (keys.currentKey) updateSeconds(keys.currentKey as VideoSeconds)
          }}
          items={secondItems}
          selectionMode="single"
          disallowEmptySelection>
          {(item) => (
            <SelectItem key={item.key} textValue={item.key}>
              <span>{item.key}</span>
            </SelectItem>
          )}
        </Select>
      </SettingItem>
      <SettingItem>
        <Select
          label={t('video.size')}
          labelPlacement="outside"
          selectedKeys={[params.params.size ?? '720x1280']}
          onSelectionChange={(keys) => {
            if (keys.currentKey) updateSize(keys.currentKey as VideoSize)
          }}
          items={sizeItems}
          selectionMode="single"
          disallowEmptySelection>
          {(item) => (
            <SelectItem key={item.key} textValue={item.key}>
              <span>{item.key}</span>
            </SelectItem>
          )}
        </Select>
      </SettingItem>
    </SettingsGroup>
  )
}
