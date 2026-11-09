import { Image } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { prepareComposerQuickPanelSearch } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { GENERATE_IMAGE_GEOMETRY_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { type QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import type { useAssistant } from '@renderer/hooks/useAssistant'
import { toast } from '@renderer/services/toast'
import { deriveChipLabel } from '@renderer/utils/imageSize'
import type { AssistantSettings } from '@shared/data/types/assistant'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

type Geometry = NonNullable<AssistantSettings['imageGenerationGeometry']>
const symbol = 'generate-image-geometry'

export function GenerateImageGeometryPicker({
  assistant,
  updateAssistant,
  toggleLauncher,
  launcher
}: {
  assistant: ReturnType<typeof useAssistant>['assistant']
  updateAssistant: ReturnType<typeof useAssistant>['updateAssistant']
  toggleLauncher: ComposerToolLauncher
  launcher: ToolLauncherApi
}) {
  const { t } = useTranslation()
  const [modelId] = usePreference('feature.paintings.default_model_id')
  const { isVisible, symbol: panelSymbol, updateList } = useQuickPanel()
  const ids = modelId ? parseUniqueModelId(modelId as UniqueModelId) : undefined
  const {
    data: support,
    isLoading,
    error,
    refetch
  } = useQuery('/providers/:providerId/models/:modelId*/image-generation-support', {
    params: { providerId: ids?.providerId ?? '__none__', modelId: ids?.modelId ?? '__none__' },
    enabled: Boolean(ids),
    swrOptions: { keepPreviousData: false }
  })
  useDataChange('/providers/:providerId/models/:modelId*/image-generation-support', () => void refetch())
  const saved = assistant?.settings.imageGenerationGeometry
  const save = useCallback(
    (value: Geometry | null) => {
      void updateAssistant({ settings: { imageGenerationGeometry: value } }).catch(() =>
        toast.error(t('common.save_failed'))
      )
    },
    [t, updateAssistant]
  )
  const items = useMemo<QuickPanelListItem[]>(() => {
    const result: QuickPanelListItem[] = [
      { id: 'help', label: t('chat.input.generate_image_geometry.help'), icon: <Image />, disabled: true },
      {
        id: 'auto',
        label: t('chat.input.generate_image_geometry.automatic'),
        icon: <Image />,
        isSelected: !saved,
        action: () => save(null)
      }
    ]
    if (isLoading) return [...result, { label: t('common.loading'), icon: <Image />, disabled: true }]
    if (error)
      return [
        ...result,
        { label: t('chat.input.generate_image_geometry.load_failed'), icon: <Image />, disabled: true }
      ]
    const presets = new Map<string, { value: Geometry; generate: boolean; edit: boolean }>()
    for (const mode of ['generate', 'edit'] as const) {
      for (const key of ['aspectRatio', 'size'] as const) {
        const spec = support?.modes[mode]?.supports[key]
        if (spec?.type !== 'enum') continue
        for (const value of spec.options) {
          if (key === 'size' ? !/^\d+x\d+$/i.test(value) : !/^(?:ASPECT_)?\d+[_:]\d+$/i.test(value)) continue
          const id = `${key}:${value}`
          const entry = presets.get(id) ?? {
            value: key === 'size' ? { size: value } : { aspectRatio: value },
            generate: false,
            edit: false
          }
          entry[mode] = true
          presets.set(id, entry)
        }
      }
    }
    const savedId = saved ? ('size' in saved ? `size:${saved.size}` : `aspectRatio:${saved.aspectRatio}`) : undefined
    if (saved && savedId && !presets.has(savedId)) {
      const value = 'size' in saved ? saved.size : saved.aspectRatio
      result.push({
        id: savedId,
        label: deriveChipLabel(value, value),
        description: t('chat.input.generate_image_geometry.unavailable'),
        icon: <Image />,
        isSelected: true,
        disabled: true
      })
    }
    if (!presets.size)
      result.push({ label: t('chat.input.generate_image_geometry.no_presets'), icon: <Image />, disabled: true })
    for (const [id, preset] of presets) {
      const value = 'size' in preset.value ? preset.value.size : preset.value.aspectRatio
      result.push({
        id,
        label: deriveChipLabel(value, value),
        icon: <Image />,
        isSelected: id === savedId,
        description:
          preset.generate && preset.edit
            ? undefined
            : t(
                preset.generate
                  ? 'chat.input.generate_image_geometry.generate_only'
                  : 'chat.input.generate_image_geometry.edit_only'
              ),
        action: () => save(preset.value)
      })
    }
    return result
  }, [error, isLoading, save, saved, support, t])
  useEffect(() => {
    if (isVisible && panelSymbol === symbol) updateList(items)
  }, [items, isVisible, panelSymbol, updateList])
  useEffect(
    () =>
      launcher.registerLaunchers([
        toggleLauncher,
        {
          ...GENERATE_IMAGE_GEOMETRY_TOOLBAR_MANIFEST.toolbar,
          sources: ['popover'],
          label: t('chat.input.generate_image_geometry.title'),
          active: Boolean(assistant?.settings.enableGenerateImage),
          disabled: !modelId || !assistant?.settings.enableGenerateImage,
          disabledReason: !modelId ? t('chat.input.generate_image_no_model') : undefined,
          action: ({ quickPanel, inputAdapter, parentPanel, queryAnchor, triggerInfo }) =>
            quickPanel.open({
              title: t('chat.input.generate_image_geometry.title'),
              symbol,
              list: items,
              parentPanel,
              ...prepareComposerQuickPanelSearch({ inputAdapter, queryAnchor, triggerInfo })
            })
        }
      ]),
    [assistant?.settings.enableGenerateImage, items, launcher, modelId, t, toggleLauncher]
  )
  return null
}
