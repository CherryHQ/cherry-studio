import { Tooltip } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import CopyButton from '@renderer/components/CopyButton'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { cn } from '@renderer/utils/style'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { Col, Input, Modal, Radio, Row, Select, Space } from 'antd'
import { CircleHelp, Dices, OctagonX } from 'lucide-react'
import { DynamicIcon, iconNames } from 'lucide-react/dynamic'
import type React from 'react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SelectionActionUserModalProps {
  isModalOpen: boolean
  editingAction: SelectionActionItem | null
  onOk: (data: SelectionActionItem) => void
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

  const [formData, setFormData] = useState<Partial<SelectionActionItem>>({})
  const [errors, setErrors] = useState<Partial<Record<keyof SelectionActionItem, string>>>({})

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
    const newErrors: Partial<Record<keyof SelectionActionItem, string>> = {}

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
    const actionItem: SelectionActionItem = {
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

  const handleInputChange = (field: keyof SelectionActionItem, value: string) => {
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
                <Tooltip content={t('selection.settings.user_modal.icon.tooltip')}>
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
                <Tooltip content={t('selection.settings.user_modal.icon.random')}>
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
                      <OctagonX size={18} color="var(--color-error-base)" />
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
                <Tooltip content={t('selection.settings.user_modal.model.tooltip')}>
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
            <Tooltip content={t('selection.settings.user_modal.prompt.tooltip')}>
              <QuestionIcon size={14} />
            </Tooltip>
            <Spacer />
            <div
              style={{
                fontSize: '12px',
                userSelect: 'text',
                color: 'var(--color-foreground-secondary)',
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

const ModalSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-4 flex flex-col', className)} {...props} />
)

const ModalSectionTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-2 flex items-center gap-1 font-medium', className)} {...props} />
)

const ModalSectionTitleLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('font-medium text-foreground text-sm', className)} {...props} />
)

const QuestionIcon = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof CircleHelp>) => (
  <CircleHelp className={cn('cursor-pointer text-foreground-muted', className)} {...props} />
)

const ErrorText = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('text-destructive text-xs', className)} {...props} />
)

const Spacer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex-1', className)} {...props} />
)

const IconPreview = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex h-8 w-8 items-center justify-center rounded border border-border bg-background-subtle',
      className
    )}
    {...props}
  />
)

const AssistantItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex h-7 flex-row items-center gap-2', className)} {...props} />
)

const AssistantName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('max-w-[calc(100%-60px)] truncate', className)} {...props} />
)

const CurrentTag = ({
  isCurrent,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'span'> & { isCurrent: boolean }) => (
  <span
    className={cn('rounded px-1 py-0.5 text-xs', isCurrent ? 'text-primary' : 'text-foreground-muted', className)}
    {...props}
  />
)

const DiceButton = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'ml-1 flex cursor-pointer items-center justify-center transition-all active:rotate-[720deg] [&_.btn-icon]:text-foreground-secondary hover:[&_.btn-icon]:text-primary',
      className
    )}
    {...props}
  />
)

export default SelectionActionUserModal
