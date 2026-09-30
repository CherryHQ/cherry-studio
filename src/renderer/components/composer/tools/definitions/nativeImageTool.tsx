import { Image } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { defineTool, type ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProviderById } from '@renderer/hooks/useProvider'
import { isNativeImageGenerationAvailable } from '@shared/ai/nativeImageGeneration'
import { parseUniqueModelId, type Model } from '@shared/data/types/model'

import { TopicType } from '../types'

const NativeImageRuntime = ({
  assistantId,
  model,
  launcher
}: {
  assistantId: string
  model: Model
  launcher: ToolLauncherApi
}) => {
  const { t } = useTranslation()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const { provider } = useProviderById(parseUniqueModelId(model.id).providerId)
  const available = isNativeImageGenerationAvailable(model, provider)
  const enabled = assistant?.settings.enableNativeImageGeneration === true
  const toggle = useCallback(() => {
    if (available && assistant) void updateAssistant({ settings: { enableNativeImageGeneration: !enabled } })
  }, [available, assistant, enabled, updateAssistant])
  useEffect(() => {
    if (!available) return
    return launcher.registerLaunchers([
      {
        id: 'native-image',
        kind: 'command',
        order: 21,
        icon: <Image size={18} />,
        sources: ['popover'],
        label: `${t('chat.input.generate_image')} · Grok`,
        active: enabled,
        action: toggle
      }
    ])
  }, [available, enabled, launcher, t, toggle])
  return null
}

export default defineTool({
  key: 'native_image',
  label: (t) => `${t('chat.input.generate_image')} · Grok`,
  visibleInScopes: [TopicType.Chat],
  composer: {
    runtime: ({ context }) => (
      <NativeImageRuntime assistantId={context.assistant!.id} model={context.model} launcher={context.launcher} />
    )
  }
})
