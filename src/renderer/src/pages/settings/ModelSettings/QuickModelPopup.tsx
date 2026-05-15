import {
  Button,
  ColFlex,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Divider,
  Flex,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ResetIcon } from '@renderer/components/Icons'
import { CircleHelp } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../../../components/TopView'
import { SettingSubtitle } from '..'

interface Props {
  resolve: (data: any) => void
}

export const TopicNamingSettings = () => {
  const [enableTopicNaming, setEnableTopicNaming] = usePreference('topic.naming.enabled')
  const [topicNamingPrompt, setTopicNamingPrompt] = usePreference('topic.naming_prompt')
  const { t } = useTranslation()

  const handleReset = useCallback(() => {
    void setTopicNamingPrompt('')
  }, [setTopicNamingPrompt])

  return (
    <section>
      <SettingSubtitle className="mt-0 mb-3">{t('settings.models.topic_naming.label')}</SettingSubtitle>

      <ColFlex className="items-stretch rounded-md border border-border/60 bg-muted/20">
        <RowFlex className="min-h-11 items-center justify-between gap-4 px-3 py-2.5">
          <div className="font-medium text-foreground text-sm">{t('settings.models.topic_naming.auto')}</div>
          <Switch checked={enableTopicNaming} onCheckedChange={setEnableTopicNaming} />
        </RowFlex>

        <Divider style={{ margin: 0 }} />

        <div className="space-y-2 px-3 pt-3 pb-3.5">
          <Flex className="min-h-7 items-center justify-between gap-2">
            <RowFlex className="min-w-0 flex-1 items-center gap-1.5">
              <div className="truncate font-medium text-foreground text-sm">
                {t('settings.models.topic_naming.prompt')}
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="size-6 shrink-0 text-foreground-muted">
                    <CircleHelp size={14} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <div className="mb-2 font-medium text-sm">
                    {t('assistants.presets.add.prompt.variables.tip.title')}
                  </div>
                  <pre className="whitespace-pre-wrap text-muted-foreground text-xs leading-5">
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

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const closePopup = () => {
    setOpen(false)
    resolve({})
  }

  TopicNamingModalPopup.hide = closePopup

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closePopup()}>
      <DialogContent className="p-6" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('settings.models.quick_model.setting_title')}</DialogTitle>
        </DialogHeader>
        <TopicNamingSettings />
        <DialogFooter>
          <Button variant="outline" onClick={closePopup}>
            {t('common.cancel')}
          </Button>
          <Button onClick={closePopup}>{t('common.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'TopicNamingModalPopup'

export default class TopicNamingModalPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
