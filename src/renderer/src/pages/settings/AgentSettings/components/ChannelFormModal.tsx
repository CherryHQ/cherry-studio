import type { CherryClawChannel } from '@renderer/types'
import { Input, Modal } from 'antd'
import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ChannelFormData = {
  name: string
  type: 'telegram'
  enabled: boolean
  config: {
    bot_token: string
    allowed_chat_ids_raw: string
  }
  is_notify_receiver: boolean
}

type ChannelFormModalProps = {
  open: boolean
  isEdit?: boolean
  initialData?: CherryClawChannel
  onSave: (data: Omit<CherryClawChannel, 'id'>) => void
  onCancel: () => void
}

const defaultForm: ChannelFormData = {
  name: '',
  type: 'telegram',
  enabled: true,
  config: { bot_token: '', allowed_chat_ids_raw: '' },
  is_notify_receiver: false
}

const ChannelFormModal: FC<ChannelFormModalProps> = ({ open, isEdit = false, initialData, onSave, onCancel }) => {
  const { t } = useTranslation()
  const [form, setForm] = useState<ChannelFormData>({ ...defaultForm })

  useEffect(() => {
    if (open && initialData) {
      setForm({
        name: initialData.name,
        type: initialData.type,
        enabled: initialData.enabled !== false,
        config: {
          bot_token: initialData.config.bot_token ?? '',
          allowed_chat_ids_raw: (initialData.config.allowed_chat_ids ?? []).join(', ')
        },
        is_notify_receiver: initialData.is_notify_receiver ?? false
      })
    } else if (open) {
      setForm({ ...defaultForm })
    }
  }, [open, initialData])

  const parseChatIds = (raw: string): string[] =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

  const handleSave = () => {
    onSave({
      name: form.name.trim(),
      type: form.type,
      enabled: form.enabled,
      config: {
        bot_token: form.config.bot_token.trim(),
        allowed_chat_ids: parseChatIds(form.config.allowed_chat_ids_raw)
      },
      is_notify_receiver: form.is_notify_receiver
    })
  }

  const isValid = form.name.trim() && form.config.bot_token.trim()

  return (
    <Modal
      open={open}
      title={
        isEdit
          ? t('agent.cherryClaw.channels.editTitle', 'Edit Channel')
          : t('agent.cherryClaw.channels.addTitle', 'Add Channel')
      }
      onOk={handleSave}
      onCancel={onCancel}
      okText={t('agent.cherryClaw.channels.save', 'Save')}
      cancelText={t('agent.cherryClaw.channels.cancel', 'Cancel')}
      okButtonProps={{ disabled: !isValid }}
      destroyOnClose>
      <div className="flex flex-col gap-4 py-2">
        <div>
          <label className="mb-1 block font-medium text-sm">
            {t('agent.cherryClaw.channels.name.label', 'Channel Name')}
          </label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={t('agent.cherryClaw.channels.name.placeholder', 'e.g. Support Bot')}
          />
        </div>

        <div>
          <label className="mb-1 block font-medium text-sm">
            {t('agent.cherryClaw.channels.telegram.botToken', 'Bot Token')}
          </label>
          <Input.Password
            value={form.config.bot_token}
            onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, bot_token: e.target.value } }))}
            placeholder={t('agent.cherryClaw.channels.telegram.botTokenPlaceholder', 'Enter Telegram bot token')}
          />
        </div>

        <div>
          <label className="mb-1 block font-medium text-sm">
            {t('agent.cherryClaw.channels.telegram.chatIds', 'Allowed Chat IDs')}
          </label>
          <Input
            value={form.config.allowed_chat_ids_raw}
            onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, allowed_chat_ids_raw: e.target.value } }))}
            placeholder={t('agent.cherryClaw.channels.telegram.chatIdsPlaceholder', '123456789, 987654321')}
          />
          <span className="mt-1 block text-gray-400 text-xs">
            {t('agent.cherryClaw.channels.telegram.chatIdsHint', 'Comma-separated. Leave empty to allow all chats.')}
          </span>
        </div>
      </div>
    </Modal>
  )
}

export default ChannelFormModal
