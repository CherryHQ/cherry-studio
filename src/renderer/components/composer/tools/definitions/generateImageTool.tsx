import { usePreference } from '@data/hooks/usePreference'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { defineTool, type ToolLauncherApi, TopicType } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { Image } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistantId: string
  launcher: ToolLauncherApi
}

/**
 * Toggle that flips `assistant.settings.enableGenerateImage`, which gates the `generate_image`
 * builtin tool on the main side (see `PaintingTool.ts`'s `applies`). The actual image is produced
 * by a separate painting model configured in Settings › Default Model, so the toggle is disabled
 * (with a hint) until one is set — there is nothing to generate with otherwise.
 */
const useGenerateImageToolController = ({ assistantId, launcher }: Props) => {
  const { t } = useTranslation()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const [paintingModelId] = usePreference('feature.paintings.default_model_id')

  const enabled = assistant?.settings.enableGenerateImage ?? false
  const disabledReason = paintingModelId ? undefined : t('chat.input.generate_image_no_model')
  const isDisabled = Boolean(disabledReason)

  const handleToggle = useCallback(() => {
    if (!assistant || isDisabled) return
    void updateAssistant({ settings: { enableGenerateImage: !enabled } })
  }, [assistant, enabled, isDisabled, updateAssistant])

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        id: 'generate-image',
        kind: 'command',
        sources: ['popover'],
        order: 20,
        label: t('chat.input.generate_image'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'chat.input.generate_image', ['generate image']),
        disabledReason,
        icon: <Image size={18} />,
        active: enabled,
        disabled: isDisabled,
        action: handleToggle
      }
    ])
  }, [disabledReason, enabled, handleToggle, isDisabled, launcher, t])

  return { enabled, handleToggle }
}

const GenerateImageComposerRuntime: FC<Props> = (props) => {
  useGenerateImageToolController(props)
  return null
}

const generateImageTool = defineTool({
  key: 'generate_image',
  label: (t) => t('chat.input.generate_image'),
  visibleInScopes: [TopicType.Chat],
  composer: {
    runtime: ({ context }) => (
      <GenerateImageComposerRuntime assistantId={context.assistant!.id} launcher={context.launcher} />
    )
  }
})

export default generateImageTool
