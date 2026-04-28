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

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [enableTopicNaming, setEnableTopicNaming] = usePreference('topic.naming.enabled')
  const [topicNamingPrompt, setTopicNamingPrompt] = usePreference('topic.naming_prompt')

  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const closePopup = () => {
    setOpen(false)
    resolve({})
  }

  const handleReset = useCallback(() => {
    void setTopicNamingPrompt('')
  }, [setTopicNamingPrompt])

  TopicNamingModalPopup.hide = closePopup

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closePopup()}>
      <DialogContent className="p-6" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('settings.models.quick_model.setting_title')}</DialogTitle>
        </DialogHeader>
        <SettingSubtitle style={{ marginTop: 0, marginBottom: 8 }}>
          {t('settings.models.topic_naming.label')}
        </SettingSubtitle>
        <ColFlex className="items-stretch gap-2">
          <RowFlex className="items-center gap-4">
            <div>{t('settings.models.topic_naming.auto')}</div>
            <Switch checked={enableTopicNaming} onCheckedChange={setEnableTopicNaming} />
          </RowFlex>
          <Divider style={{ margin: 0 }} />
          <div>
            <Flex className="mb-1 h-[30px] items-center gap-1">
              <div>{t('settings.models.topic_naming.prompt')}</div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="size-6 text-foreground-muted">
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
              {topicNamingPrompt && (
                <Button onClick={handleReset} variant="ghost" size="icon">
                  <ResetIcon size={14} />
                </Button>
              )}
            </Flex>
            <Textarea.Input
              rows={3}
              className="max-h-60 min-h-20 w-full"
              value={topicNamingPrompt || t('prompts.title')}
              onChange={(e) => void setTopicNamingPrompt(e.target.value)}
              placeholder={t('prompts.title')}
            />
          </div>
        </ColFlex>
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
