import { usePreference } from '@data/hooks/usePreference'
import { CircleHelp } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ColFlex,
  Divider,
  Flex,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import ResetIcon from '@renderer/components/icons/ResetIcon'
import { SettingSubtitle } from '@renderer/components/SettingsPrimitives'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'

import { DefaultModelSelector } from './DefaultModelSelector'

const chatModelFilter = (model: Model) => !isNonChatModel(model)

export const TopicNamingSettings = () => {
  const [enableTopicNaming, setEnableTopicNaming] = usePreference('topic.naming.enabled')
  const [topicNamingModelId, setTopicNamingModelId] = usePreference('topic.naming.model_id')
  const [topicNamingPrompt, setTopicNamingPrompt] = usePreference('topic.naming_prompt')
  const { t } = useTranslation()

  const { model: topicNamingModel } = useModelById(topicNamingModelId as UniqueModelId | null)
  const { providers } = useProviders({ enabled: true })

  const handleSelectModel = useCallback(
    (selected: Model | undefined) => {
      if (!selected) return
      void setTopicNamingModelId(selected.id)
    },
    [setTopicNamingModelId]
  )

  const handleReset = useCallback(() => {
    void setTopicNamingPrompt('')
  }, [setTopicNamingPrompt])

  return (
    <section>
      <SettingSubtitle className="mt-0 mb-3">{t('settings.models.topic_naming.label')}</SettingSubtitle>

      <ColFlex className="items-stretch rounded-md border border-border-subtle">
        <RowFlex className="min-h-11 items-center justify-between gap-4 px-3 py-2.5">
          <div className="text-sm text-foreground">{t('settings.models.topic_naming.auto')}</div>
          <Switch checked={enableTopicNaming} onCheckedChange={setEnableTopicNaming} />
        </RowFlex>

        <Divider className="m-0" />

        <RowFlex className="min-h-11 items-center justify-between gap-4 px-3 py-2.5">
          <div className="shrink-0 text-sm text-foreground">{t('settings.models.topic_naming.model')}</div>
          <div className="flex w-[220px] min-w-0 items-center">
            <DefaultModelSelector
              model={topicNamingModel}
              providers={providers}
              filter={chatModelFilter}
              onSelect={handleSelectModel}
              placeholder={t('settings.models.empty')}
            />
          </div>
        </RowFlex>

        <Divider className="m-0" />

        <div className="space-y-2 px-3 pt-3 pb-3.5">
          <Flex className="min-h-7 items-center justify-between gap-2">
            <RowFlex className="min-w-0 flex-1 items-center gap-1.5">
              <div className="truncate text-sm text-foreground">{t('settings.models.topic_naming.prompt')}</div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="size-6 shrink-0 text-muted-foreground">
                    <CircleHelp size={14} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <div className="mb-2 text-sm">{t('assistants.presets.add.prompt.variables.tip.title')}</div>
                  <pre className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                    {t('assistants.presets.add.prompt.variables.tip.content')}
                  </pre>
                </PopoverContent>
              </Popover>
            </RowFlex>

            {topicNamingPrompt && (
              <Button onClick={handleReset} variant="ghost" size="icon-sm" className="size-7 shrink-0">
                <ResetIcon size={14} />
              </Button>
            )}
          </Flex>
          <Textarea.Input
            rows={3}
            className="max-h-60 min-h-28 w-full resize-y text-sm leading-5"
            value={topicNamingPrompt || t('prompts.title')}
            onChange={(e) => void setTopicNamingPrompt(e.target.value)}
            placeholder={t('prompts.title')}
          />
        </div>
      </ColFlex>
    </section>
  )
}
