import { QuestionCircleOutlined } from '@ant-design/icons'
import { ColFlex, Flex, RowFlex } from '@cherrystudio/ui'
import { Switch } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ResetIcon } from '@renderer/components/Icons'
import { Divider, Input, Modal, Popover } from 'antd'
import { useCallback, useMemo, useState } from 'react'
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

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const handleReset = useCallback(() => {
    setTopicNamingPrompt('')
  }, [setTopicNamingPrompt])

  TopicNamingModalPopup.hide = onCancel

  const promptVarsContent = useMemo(() => <pre>{t('agents.add.prompt.variables.tip.content')}</pre>, [t])

  return (
    <Modal
      title={t('settings.models.quick_model.setting_title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      maskClosable={false}
      transitionName="animation-move-down"
      centered
      style={{ padding: '24px' }}>
      <SettingSubtitle style={{ marginTop: 0, marginBottom: 8 }}>
        {t('settings.models.topic_naming.label')}
      </SettingSubtitle>
      <ColFlex className="items-stretch gap-2">
        <RowFlex className="items-center gap-4">
          <div>{t('settings.models.topic_naming.auto')}</div>
          <Switch isSelected={enableTopicNaming} onValueChange={setEnableTopicNaming} />
        </RowFlex>
        <Divider style={{ margin: 0 }} />
        <div>
          <Flex className="mb-1 h-[30px] items-center gap-1">
            <div>{t('settings.models.topic_naming.prompt')}</div>
            <Popover title={t('agents.add.prompt.variables.tip.title')} content={promptVarsContent}>
              <QuestionCircleOutlined size={14} style={{ color: 'var(--color-text-2)' }} />
            </Popover>
            {topicNamingPrompt && (
              <Button startContent={<ResetIcon size={14} />} onPress={handleReset} variant="light" isIconOnly />
            )}
          </Flex>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 10 }}
            value={topicNamingPrompt || t('prompts.title')}
            onChange={(e) => setTopicNamingPrompt(e.target.value)}
            placeholder={t('prompts.title')}
            style={{ width: '100%' }}
          />
        </div>
      </ColFlex>
    </Modal>
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
