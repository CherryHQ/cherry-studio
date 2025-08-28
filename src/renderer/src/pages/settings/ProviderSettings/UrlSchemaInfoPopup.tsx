import { TopView } from '@renderer/components/TopView'
import { Input, Modal, Space } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  providerName: string
  providerId: string
  baseUrl?: string
  apiKey: string
  confirmMessage: string
  okText: string
}

interface Props extends ShowParams {
  resolve: (confirmed: boolean) => void
}

const PopupContainer = ({ providerName, providerId, baseUrl, apiKey, confirmMessage, okText, resolve }: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  const handleOk = () => {
    setOpen(false)
    resolve(true)
  }

  const handleCancel = () => {
    setOpen(false)
    resolve(false)
  }

  return (
    <Modal
      title={t('settings.models.provider_key_confirm_title', { provider: providerName })}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={okText}
      cancelText={t('common.cancel')}
      width={600}
      transitionName="animation-move-down"
      centered>
      <Container>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input addonBefore={t('settings.models.provider_name')} value={providerName} disabled />
          <Input addonBefore={t('settings.models.provider_id')} value={providerId} disabled />
          {baseUrl && <Input addonBefore={t('settings.models.base_url')} value={baseUrl} disabled />}
          <Input.Password addonBefore={t('settings.models.api_key')} value={apiKey} disabled />
        </Space>
        <ConfirmMessage>{confirmMessage}</ConfirmMessage>
      </Container>
    </Modal>
  )
}

const Container = styled.div`
  margin-top: 24px;
  margin-bottom: 12px;
`

const ConfirmMessage = styled.div`
  color: var(--color-text);
  line-height: 1.5;
  margin-top: 16px;
`

const TopViewKey = 'UrlSchemaInfoPopup'

export default class UrlSchemaInfoPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<boolean>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        TopViewKey
      )
    })
  }
}
