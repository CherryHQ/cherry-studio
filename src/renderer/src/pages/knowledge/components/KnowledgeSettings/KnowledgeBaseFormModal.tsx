import type { ModalProps } from 'antd'
import { Button, Modal } from 'antd'
import { ChevronDown, ChevronUp } from 'lucide-react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface PanelConfig {
  key: string
  label: string
  panel: React.ReactNode
}

interface KnowledgeBaseFormModalProps extends Omit<ModalProps, 'children' | 'footer'> {
  panels: PanelConfig[]
  onMoreSettings?: () => void
  defaultExpandAdvanced?: boolean
}

const KnowledgeBaseFormModal: React.FC<KnowledgeBaseFormModalProps> = ({
  panels,
  onMoreSettings,
  defaultExpandAdvanced = false,
  okText,
  onOk,
  onCancel,
  ...rest
}) => {
  const { t } = useTranslation()
  const [showAdvanced, setShowAdvanced] = useState(defaultExpandAdvanced)

  const generalPanel = panels.find((p) => p.key === 'general')
  const advancedPanel = panels.find((p) => p.key === 'advanced')

  const footer = (
    <FooterContainer>
      <div style={{ display: 'flex', gap: 8 }}>
        {advancedPanel && (
          <Button
            onClick={() => setShowAdvanced(!showAdvanced)}
            icon={showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}>
            {t('settings.advanced.title')}
          </Button>
        )}
        {onMoreSettings && <Button onClick={onMoreSettings}>{t('settings.moresetting.title')}</Button>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="primary" onClick={onOk}>
          {okText || t('common.confirm')}
        </Button>
      </div>
    </FooterContainer>
  )

  return (
    <StyledModal
      destroyOnHidden
      maskClosable={false}
      centered
      transitionName="animation-move-down"
      width="min(500px, 60vw)"
      styles={{
        body: { padding: '16px 8px', maxHeight: '70vh', overflowY: 'auto' },
        header: {
          padding: '12px 20px',
          borderBottom: '0.5px solid var(--color-border)',
          margin: 0,
          borderRadius: 0
        },
        content: {
          padding: 0,
          overflow: 'hidden'
        },
        footer: {
          padding: '12px 20px',
          borderTop: '0.5px solid var(--color-border)',
          margin: 0
        }
      }}
      footer={footer}
      okText={okText}
      onOk={onOk}
      onCancel={onCancel}
      {...rest}>
      <ContentContainer>
        {/* General Settings */}
        {generalPanel && <div>{generalPanel.panel}</div>}

        {/* Advanced Settings */}
        {showAdvanced && advancedPanel && (
          <AdvancedSettingsContainer>
            <AdvancedSettingsTitle>{advancedPanel.label}</AdvancedSettingsTitle>
            <div>{advancedPanel.panel}</div>
          </AdvancedSettingsContainer>
        )}
      </ContentContainer>
    </StyledModal>
  )
}

const StyledModal = styled(Modal)`
  .ant-modal-title {
    font-size: 14px;
    font-weight: 500;
  }
  .ant-modal-close {
    top: 8px;
    right: 8px;
  }
`

const ContentContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const FooterContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`

const AdvancedSettingsContainer = styled.div`
  margin-top: 16px;
  padding-top: 16px;
  border-top: 0.5px solid var(--color-border);
`

const AdvancedSettingsTitle = styled.div`
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text-1);
  margin-bottom: 16px;
  padding: 0 16px;
`

export default KnowledgeBaseFormModal
