import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import CopyButton from '@renderer/components/CopyButton'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { getDefaultModel } from '@renderer/services/AssistantService'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { Col, Input, Modal, Radio, Row, Select, Space, Tooltip } from 'antd'
import { CircleHelp, Dices, OctagonX } from 'lucide-react'
import { DynamicIcon, iconNames } from 'lucide-react/dynamic'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface SelectionActionUserModalProps {
  isModalOpen: boolean
  editingAction: ActionItem | null
  onOk: (data: ActionItem) => void
  onCancel: () => void
}

const SelectionActionUserModal: FC<SelectionActionUserModalProps> = ({
  isModalOpen,
  editingAction,
  onOk,
  onCancel
}) => {
  const { t } = useTranslation()
  const { assistants: userPredefinedAssistants } = useAssistants()
  const { defaultAssistant } = useDefaultAssistant()

  const [formData, setFormData] = useState<Partial<ActionItem>>({})
  const [errors, setErrors] = useState<Partial<Record<keyof ActionItem, string>>>({})

  useEffect(() => {
    if (isModalOpen) {
      // 如果是编辑模式，使用现有数据；否则使用空数据
      setFormData(
        editingAction || {
          name: '',
          prompt: '',
          icon: '',
          assistantId: ''
        }
      )
      setErrors({})
    }
  }, [isModalOpen, editingAction])

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof ActionItem, string>> = {}

    if (!formData.name?.trim()) {
      newErrors.name = t('selection.settings.user_modal.name.hint')
    }

    if (formData.icon && !iconNames.includes(formData.icon as any)) {
      newErrors.icon = t('selection.settings.user_modal.icon.error')
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleOk = () => {
    if (!validateForm()) {
      return
    }

    // 构建完整的 ActionItem
    const actionItem: ActionItem = {
      id: editingAction?.id || `user-${Date.now()}`,
      name: formData.name || 'USER',
      enabled: editingAction?.enabled || false,
      isBuiltIn: editingAction?.isBuiltIn || false,
      icon: formData.icon,
      prompt: formData.prompt,
      assistantId: formData.assistantId
    }

    onOk(actionItem)
  }

  const handleInputChange = (field: keyof ActionItem, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  return (
    <Modal
      title={
        editingAction ? t('selection.settings.user_modal.title.edit') : t('selection.settings.user_modal.title.add')
      }
      open={isModalOpen}
      onOk={handleOk}
      onCancel={onCancel}
      width={520}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <ModalSection>
          <div style={{ display: 'flex', flexDirection: 'row' }}>
            <Col flex="auto" style={{ paddingRight: '16px', width: '70%' }}>
              <ModalSectionTitle>
                <ModalSectionTitleLabel>{t('selection.settings.user_modal.name.label')}</ModalSectionTitleLabel>
              </ModalSectionTitle>
              <Input
                placeholder={t('selection.settings.user_modal.name.hint')}
                value={formData.name || ''}
                onChange={(e) => handleInputChange('name', e.target.value)}
                maxLength={16}
                status={errors.name ? 'error' : ''}
              />
              {errors.name && <ErrorText>{errors.name}</ErrorText>}
            </Col>
            <Col>
              <ModalSectionTitle>
                <ModalSectionTitleLabel>{t('selection.settings.user_modal.icon.label')}</ModalSectionTitleLabel>
                <Tooltip placement="top" title={t('selection.settings.user_modal.icon.tooltip')} arrow>
                  <QuestionIcon size={14} />
                </Tooltip>
                <Spacer />
                <a
                  href="https://lucide.dev/icons/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '12px', color: 'var(--color-primary)' }}>
                  {t('selection.settings.user_modal.icon.view_all')}
                </a>
                <Tooltip title={t('selection.settings.user_modal.icon.random')}>
                  <DiceButton
                    onClick={() => {
                      const randomIcon = iconNames[Math.floor(Math.random() * iconNames.length)]
                      handleInputChange('icon', randomIcon)
                    }}>
                    <Dices size={14} className="btn-icon" />
                  </DiceButton>
                </Tooltip>
              </ModalSectionTitle>
              <Space>
                <Input
                  placeholder={t('selection.settings.user_modal.icon.placeholder')}
                  value={formData.icon || ''}
                  onChange={(e) => handleInputChange('icon', e.target.value)}
                  style={{ width: '100%' }}
                  status={errors.icon ? 'error' : ''}
                />
                <IconPreview>
                  {formData.icon &&
                    (iconNames.includes(formData.icon as any) ? (
                      <DynamicIcon name={formData.icon as any} size={18} />
                    ) : (
                      <OctagonX size={18} color="var(--color-error)" />
                    ))}
                </IconPreview>
              </Space>
              {errors.icon && <ErrorText>{errors.icon}</ErrorText>}
            </Col>
          </div>
        </ModalSection>
        <ModalSection>
          <Row>
            <Col flex="auto" style={{ paddingRight: '16px' }}>
              <ModalSectionTitle>
                <ModalSectionTitleLabel>{t('selection.settings.user_modal.model.label')}</ModalSectionTitleLabel>
                <Tooltip placement="top" title={t('selection.settings.user_modal.model.tooltip')} arrow>
                  <QuestionIcon size={14} />
                </Tooltip>
              </ModalSectionTitle>
            </Col>
            <Radio.Group
              value={formData.assistantId ? 'assistant' : 'default'}
              onChange={(e) =>
                handleInputChange('assistantId', e.target.value === 'default' ? '' : defaultAssistant.id)
              }
              buttonStyle="solid">
              <Radio.Button value="default">{t('selection.settings.user_modal.model.default')}</Radio.Button>
              <Radio.Button value="assistant">{t('selection.settings.user_modal.model.assistant')}</Radio.Button>
            </Radio.Group>
          </Row>
        </ModalSection>

        {formData.assistantId && (
          <ModalSection>
            <ModalSectionTitle>
              <ModalSectionTitleLabel>{t('selection.settings.user_modal.assistant.label')}</ModalSectionTitleLabel>
            </ModalSectionTitle>
            <Select
              value={formData.assistantId || defaultAssistant.id}
              onChange={(value) => handleInputChange('assistantId', value)}
              style={{ width: '100%' }}
              dropdownRender={(menu) => menu}>
              <Select.Option key={defaultAssistant.id} value={defaultAssistant.id}>
                <AssistantItem>
                  <ModelAvatar model={defaultAssistant.model || getDefaultModel()} size={18} />
                  <AssistantName>{defaultAssistant.name}</AssistantName>
                  <Spacer />
                  <CurrentTag isCurrent={true}>{t('selection.settings.user_modal.assistant.default')}</CurrentTag>
                </AssistantItem>
              </Select.Option>
              {userPredefinedAssistants
                .filter((a) => a.id !== defaultAssistant.id)
                .map((a) => (
                  <Select.Option key={a.id} value={a.id}>
                    <AssistantItem>
                      <ModelAvatar model={a.model || getDefaultModel()} size={18} />
                      <AssistantName>{a.name}</AssistantName>
                      <Spacer />
                    </AssistantItem>
                  </Select.Option>
                ))}
            </Select>
          </ModalSection>
        )}
        <ModalSection>
          <ModalSectionTitle>
            <ModalSectionTitleLabel>{t('selection.settings.user_modal.prompt.label')}</ModalSectionTitleLabel>
            <Tooltip placement="top" title={t('selection.settings.user_modal.prompt.tooltip')} arrow>
              <QuestionIcon size={14} />
            </Tooltip>
            <Spacer />
            <div
              style={{
                fontSize: '12px',
                userSelect: 'text',
                color: 'var(--color-text-2)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
              {t('selection.settings.user_modal.prompt.placeholder_text')} {'{{text}}'}
              <CopyButton tooltip={t('selection.settings.user_modal.prompt.copy_placeholder')} textToCopy="{{text}}" />
            </div>
          </ModalSectionTitle>
          <Input.TextArea
            placeholder={t('selection.settings.user_modal.prompt.placeholder')}
            value={formData.prompt || ''}
            onChange={(e) => handleInputChange('prompt', e.target.value)}
            rows={4}
            style={{ resize: 'none' }}
          />
        </ModalSection>
      </Space>
    </Modal>
  )
}

const ModalSection = styled.div`
  display: flex;
  flex-direction: column;
  margin-top: 16px;
`

const ModalSectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  margin-bottom: 8px;
`

const ModalSectionTitleLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
`

const QuestionIcon = styled(CircleHelp)`
  cursor: pointer;
  color: var(--color-text-3);
`

const ErrorText = styled.div`
  color: var(--color-error);
  font-size: 12px;
`

const Spacer = styled.div`
  flex: 1;
`

const IconPreview = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--color-bg-2);
  border-radius: 4px;
  border: 1px solid var(--color-border);
`

const AssistantItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 28px;
`

const AssistantName = styled.span`
  max-width: calc(100% - 60px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const CurrentTag = styled.span<{ isCurrent: boolean }>`
  color: ${(props) => (props.isCurrent ? 'var(--color-primary)' : 'var(--color-text-3)')};
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
`

const DiceButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  margin-left: 4px;

  .btn-icon {
    color: var(--color-text-2);
  }

  &:hover {
    .btn-icon {
      color: var(--color-primary);
    }
  }

  &:active {
    transform: rotate(720deg);
  }
`

export default SelectionActionUserModal
