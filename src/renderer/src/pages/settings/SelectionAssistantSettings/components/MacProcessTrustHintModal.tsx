import { Button, Modal, Typography } from 'antd'
import { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Text, Paragraph } = Typography

interface MacProcessTrustHintModalProps {
  open: boolean
  onClose: () => void
}

const MacProcessTrustHintModal: FC<MacProcessTrustHintModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation()

  const handleOpenAccessibility = () => {
    window.api.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    onClose()
  }

  const handleConfirm = async () => {
    window.api.mac.requestProcessTrust()
    onClose()
  }

  return (
    <Modal
      title={t('selection.settings.enable.mac_process_trust_hint.title')}
      open={open}
      onCancel={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <Button type="link" style={{ color: 'var(--color-text-3)', fontSize: 12 }} onClick={handleOpenAccessibility}>
            {t('selection.settings.enable.mac_process_trust_hint.button.open_accessibility_settings')}
          </Button>
          <Button type="primary" onClick={handleConfirm}>
            {t('selection.settings.enable.mac_process_trust_hint.button.go_to_settings')}
          </Button>
        </div>
      }
      centered
      destroyOnClose>
      <ContentContainer>
        <Paragraph>
          <Text>
            <Trans i18nKey="selection.settings.enable.mac_process_trust_hint.description.0" />
          </Text>
        </Paragraph>
        <Paragraph>
          <Text>
            <Trans i18nKey="selection.settings.enable.mac_process_trust_hint.description.1" />
          </Text>
        </Paragraph>
        <Paragraph>
          <Text>
            <Trans i18nKey="selection.settings.enable.mac_process_trust_hint.description.2" />
          </Text>
        </Paragraph>
      </ContentContainer>
    </Modal>
  )
}

const ContentContainer = styled.div`
  padding: 16px 0;
`

export default MacProcessTrustHintModal
