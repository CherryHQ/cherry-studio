import { QuestionCircleOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setEnableTopicNaming, setTopicNamingPrompt } from '@renderer/store/settings'
import { Button, Divider, Flex, Input, Modal, Popover, Switch } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../../../components/TopView'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { enableTopicNaming, topicNamingPrompt } = useSettings()
  const dispatch = useAppDispatch()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const handleReset = () => {
    dispatch(setTopicNamingPrompt(''))
  }

  TopicNamingModalPopup.hide = onCancel

  const promptVarsContent = <pre>{t('agents.add.prompt.variables.tip.content')}</pre>

  return (
    <Modal
      title={t('settings.models.topic_naming_model_setting_title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      maskClosable={false}
      transitionName="animation-move-down"
      footer={null}
      centered>
      <Divider style={{ margin: '10px 0' }} />
      <HStack style={{ gap: 10, marginBottom: 20, marginTop: 20 }} alignItems="center">
        <div>{t('settings.models.enable_topic_naming')}</div>
        <Switch checked={enableTopicNaming} onChange={(v) => dispatch(setEnableTopicNaming(v))} />
      </HStack>
      <Divider style={{ margin: '10px 0' }} />
      <div style={{ marginBottom: 20 }}>
        <Flex align="center" style={{ marginBottom: 10, gap: 5 }}>
          <div>{t('settings.models.topic_naming_prompt')}</div>
          <Popover title={t('agents.add.prompt.variables.tip.title')} content={promptVarsContent}>
            <QuestionCircleOutlined size={14} style={{ color: 'var(--color-text-2)' }} />
          </Popover>
        </Flex>
        <Input.TextArea
          rows={4}
          value={topicNamingPrompt || t('prompts.title')}
          onChange={(e) => dispatch(setTopicNamingPrompt(e.target.value.trim()))}
          placeholder={t('prompts.title')}
        />
        {topicNamingPrompt && (
          <Button style={{ marginTop: 10 }} onClick={handleReset}>
            {t('common.reset')}
          </Button>
        )}
      </div>
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
