import { Button } from '@cherrystudio/ui'
import { ModelSelector } from '@renderer/components/ModelSelectorV2'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useModels } from '@renderer/hooks/useModels'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingDivider, SettingGroup, SettingTitle } from '.'

const ComponentLabSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { models, isLoading } = useModels({ enabled: true })
  const [selectedModel, setSelectedModel] = useState<Model>()

  useEffect(() => {
    if (selectedModel || isLoading || models.length === 0) {
      return
    }

    setSelectedModel(models[0])
  }, [isLoading, models, selectedModel])

  const resolvedModelId = selectedModel ? parseUniqueModelId(selectedModel.id).modelId : ''
  const hasModels = models.length > 0
  const selectedModelSnapshot = useMemo(() => {
    if (!selectedModel) {
      return ''
    }

    return JSON.stringify(
      {
        ...selectedModel,
        parsedModelId: resolvedModelId
      },
      null,
      2
    )
  }, [resolvedModelId, selectedModel])

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.componentLab.title')}</SettingTitle>
        <SettingDescription>{t('settings.componentLab.description')}</SettingDescription>
        <SettingDivider />

        <div className="space-y-4">
          <div className="rounded-[12px] border border-border bg-background p-4">
            <div className="mb-3">
              <div className="font-medium text-(--color-text-1) text-sm">
                {t('settings.componentLab.modelSelector.title')}
              </div>
              <div className="mt-1 text-(--color-text-3) text-xs">
                {t('settings.componentLab.modelSelector.description')}
              </div>
            </div>

            <ModelSelector
              value={selectedModel}
              onSelect={setSelectedModel}
              prioritizedProviderIds={['openai', 'anthropic', 'google', 'gemini', 'openrouter']}
              showPinnedModels
              showTagFilter
              contentClassName="w-[min(720px,calc(100vw-160px))]"
              trigger={
                <Button
                  variant="outline"
                  disabled={!hasModels}
                  className="min-w-[240px] justify-between gap-3 text-left">
                  <span className="truncate">
                    {selectedModel?.name || t('settings.componentLab.modelSelector.triggerPlaceholder')}
                  </span>
                </Button>
              }
            />

            {!hasModels && (
              <div className="mt-3 text-(--color-text-3) text-xs">
                {isLoading
                  ? t('settings.componentLab.modelSelector.loading')
                  : t('settings.componentLab.modelSelector.empty')}
              </div>
            )}
          </div>

          <div className="rounded-[12px] border border-border/80 border-dashed bg-background/70 p-4">
            <div className="mb-3 font-medium text-(--color-text-1) text-sm">
              {t('settings.componentLab.modelSelector.selected')}
            </div>

            {selectedModel ? (
              <pre className="overflow-x-auto rounded-[10px] border border-border/60 bg-background px-3 py-2 font-mono text-(--color-text-2) text-xs leading-5">
                {selectedModelSnapshot}
              </pre>
            ) : (
              <div className="text-(--color-text-3) text-sm">
                {t('settings.componentLab.modelSelector.selectedEmpty')}
              </div>
            )}
          </div>
        </div>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ComponentLabSettings
