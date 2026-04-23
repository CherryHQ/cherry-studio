import { Button } from '@cherrystudio/ui'
import { Modal, Typography } from 'antd'
import type { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'

const { Text, Paragraph } = Typography

interface MacProcessTrustHintModalProps {
  open: boolean
  onClose: () => void
}

const MacProcessTrustHintModal: FC<MacProcessTrustHintModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation()

  const handleOpenAccessibility = () => {
    void window.api.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    onClose()
  }

  const handleConfirm = async () => {
    void window.api.mac.requestProcessTrust()
    onClose()
  }

  return (
    <Modal
      title={t('selection.settings.enable.mac_process_trust_hint.title')}
      open={open}
      onCancel={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <Button
            variant="ghost"
            style={{ color: 'var(--color-text-3)', fontSize: 12 }}
            onClick={handleOpenAccessibility}>
            {t('selection.settings.enable.mac_process_trust_hint.button.open_accessibility_settings')}
          </Button>
          <Button color="primary" onClick={handleConfirm}>
            {t('selection.settings.enable.mac_process_trust_hint.button.go_to_settings')}
          </Button>
        </div>
      }
      centered
      destroyOnHidden>
      <div className="py-4">
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
      </div>
    </Modal>
  )
}

export default MacProcessTrustHintModal
