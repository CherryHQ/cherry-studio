import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import CopyButton from '@renderer/components/CopyButton'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { cn } from '@renderer/utils/style'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
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
  const { assistant: defaultAssistant } = useDefaultAssistant()
  const { defaultModel } = useDefaultModel()

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
    <Dialog open={isModalOpen} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {editingAction
              ? t('selection.settings.user_modal.title.edit')
              : t('selection.settings.user_modal.title.add')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex w-full flex-col gap-4">
          <ModalSection>
            <div className="flex flex-row">
              <div className="w-[70%] flex-auto pr-4">
                <ModalSectionTitle>
                  <ModalSectionTitleLabel>{t('selection.settings.user_modal.name.label')}</ModalSectionTitleLabel>
                </ModalSectionTitle>
                <Input
                  placeholder={t('selection.settings.user_modal.name.hint')}
                  value={formData.name || ''}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  maxLength={16}
                  aria-invalid={!!errors.name}
                />
                {errors.name && <ErrorText>{errors.name}</ErrorText>}
              </div>
              <div>
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
                    className="text-[var(--color-primary)] text-xs">
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
                <div className="flex gap-2">
                  <Input
                    placeholder={t('selection.settings.user_modal.icon.placeholder')}
                    value={formData.icon || ''}
                    onChange={(e) => handleInputChange('icon', e.target.value)}
                    className="w-full"
                    aria-invalid={!!errors.icon}
                  />
                  <IconPreview>
                    {formData.icon &&
                      (iconNames.includes(formData.icon as any) ? (
                        <DynamicIcon name={formData.icon as any} size={18} />
                      ) : (
                        <OctagonX size={18} color="var(--color-error-base)" />
                      ))}
                  </IconPreview>
                </div>
                {errors.icon && <ErrorText>{errors.icon}</ErrorText>}
              </div>
            </div>
          </ModalSection>
          <ModalSection>
            <div className="flex">
              <div className="flex-auto pr-4">
                <ModalSectionTitle>
                  <ModalSectionTitleLabel>{t('selection.settings.user_modal.model.label')}</ModalSectionTitleLabel>
                  <Tooltip content={t('selection.settings.user_modal.model.tooltip')}>
                    <QuestionIcon size={14} />
                  </Tooltip>
                </ModalSectionTitle>
              </div>
              <RadioGroup
                value={formData.assistantId ? 'assistant' : 'default'}
                onValueChange={(value) =>
                  handleInputChange('assistantId', value === 'default' ? '' : defaultAssistant.id)
                }
                className="flex flex-row gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="default" />
                  {t('selection.settings.user_modal.model.default')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="assistant" />
                  {t('selection.settings.user_modal.model.assistant')}
                </label>
              </RadioGroup>
            </div>
          </ModalSection>

          {formData.assistantId && (
            <ModalSection>
              <ModalSectionTitle>
                <ModalSectionTitleLabel>{t('selection.settings.user_modal.assistant.label')}</ModalSectionTitleLabel>
              </ModalSectionTitle>
              <Select
                value={formData.assistantId || defaultAssistant.id}
                onValueChange={(value) => handleInputChange('assistantId', value)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem key={defaultAssistant.id} value={defaultAssistant.id}>
                    <AssistantItem>
                      <ModelAvatar model={defaultModel} size={18} />
                      <AssistantName>{defaultAssistant.name}</AssistantName>
                      <Spacer />
                      <CurrentTag isCurrent={true}>{t('selection.settings.user_modal.assistant.default')}</CurrentTag>
                    </AssistantItem>
                  </SelectItem>
                  {userPredefinedAssistants
                    .filter((a) => a.id !== defaultAssistant.id)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <AssistantItem>
                          <ModelAvatar model={defaultModel} size={18} />
                          <AssistantName>{a.name}</AssistantName>
                          <Spacer />
                        </AssistantItem>
                      </SelectItem>
                    ))}
                </SelectContent>
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
              <div className="flex select-text items-center gap-1 text-[var(--color-foreground-secondary)] text-xs">
                {t('selection.settings.user_modal.prompt.placeholder_text')} {'{{text}}'}
                <CopyButton
                  tooltip={t('selection.settings.user_modal.prompt.copy_placeholder')}
                  textToCopy="{{text}}"
                />
              </div>
            </ModalSectionTitle>
            <Textarea.Input
              placeholder={t('selection.settings.user_modal.prompt.placeholder')}
              value={formData.prompt || ''}
              onChange={(e) => handleInputChange('prompt', e.target.value)}
              rows={4}
              className="resize-none"
            />
          </ModalSection>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleOk}>{t('common.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
