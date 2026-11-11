import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useDataChange, useInvalidateCache } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { GENERATE_IMAGE_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool, type ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'

import { GenerateImageGeometryPicker } from '../components/GenerateImageGeometryPicker'

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
const useGenerateImageToolController = ({ assistantId }: Props) => {
  const { t } = useTranslation()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const invalidate = useInvalidateCache()
  useDataChange('/assistants/:id', () => void invalidate(`/assistants/${assistantId}`), {
    routeParams: { id: assistantId }
  })
  const [paintingModelId] = usePreference('feature.paintings.default_model_id')

  const enabled = assistant?.settings.enableGenerateImage ?? false
  const disabledReason = paintingModelId ? undefined : t('chat.input.generate_image_no_model')
  const isDisabled = Boolean(disabledReason)

  const handleToggle = useCallback(() => {
    if (!assistant || isDisabled) return
    void updateAssistant({ settings: { enableGenerateImage: !enabled } })
  }, [assistant, enabled, isDisabled, updateAssistant])

  const toggleLauncher = useMemo<ComposerToolLauncher>(
    () => ({
      ...GENERATE_IMAGE_TOOLBAR_MANIFEST.toolbar,
      sources: ['popover'],
      label: t('chat.input.generate_image'),
      description: '',
      searchAliases: getQuickPanelSearchAliases(t, 'chat.input.generate_image', ['generate image']),
      disabledReason,
      active: enabled,
      disabled: isDisabled,
      action: handleToggle
    }),
    [disabledReason, enabled, handleToggle, isDisabled, t]
  )

  return { assistant, updateAssistant, toggleLauncher }
}

const GenerateImageComposerRuntime: FC<Props> = (props) => {
  const controller = useGenerateImageToolController(props)
  return <GenerateImageGeometryPicker {...controller} launcher={props.launcher} />
}

const generateImageTool = defineTool({
  key: 'generate_image',
  label: GENERATE_IMAGE_TOOLBAR_MANIFEST.label,
  visibleInScopes: GENERATE_IMAGE_TOOLBAR_MANIFEST.visibleInScopes,
  condition: ({ assistant }) => Boolean(assistant),
  composer: {
    runtime: ({ context }) => (
      <GenerateImageComposerRuntime assistantId={context.assistant!.id} launcher={context.launcher} />
    )
  }
})

export default generateImageTool
