import type { CherryClawChannel } from '@renderer/types'
import { Button, Popconfirm, Tag } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

type ChannelListItemProps = {
  channel: CherryClawChannel
  onEdit: (channel: CherryClawChannel) => void
  onToggleEnabled: (channel: CherryClawChannel) => void
  onDelete: (channelId: string) => void
}

const ChannelListItem: FC<ChannelListItemProps> = ({ channel, onEdit, onToggleEnabled, onDelete }) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Tag color={channel.enabled !== false ? 'green' : 'orange'}>
            {channel.enabled !== false
              ? t('agent.cherryClaw.channels.status.active', 'Active')
              : t('agent.cherryClaw.channels.status.disabled', 'Disabled')}
          </Tag>
          <span className="truncate font-medium">{channel.name}</span>
          <Tag>{channel.type}</Tag>
        </div>
        <div className="mt-1 text-gray-400 text-xs">
          {channel.config.allowed_chat_ids?.length ?? 0} {t('agent.cherryClaw.channels.chatIds', 'chat IDs allowed')}
        </div>
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-1">
        <Button size="small" type="text" onClick={() => onEdit(channel)}>
          {t('agent.cherryClaw.channels.edit', 'Edit')}
        </Button>
        <Button size="small" type="text" onClick={() => onToggleEnabled(channel)}>
          {channel.enabled !== false
            ? t('agent.cherryClaw.channels.disable', 'Disable')
            : t('agent.cherryClaw.channels.enable', 'Enable')}
        </Button>
        <Popconfirm
          title={t('agent.cherryClaw.channels.delete.confirm', 'Delete this channel?')}
          onConfirm={() => onDelete(channel.id)}
          okText={t('agent.cherryClaw.channels.delete.label', 'Delete')}
          cancelText={t('agent.cherryClaw.channels.cancel', 'Cancel')}>
          <Button size="small" type="text" danger>
            {t('agent.cherryClaw.channels.delete.label', 'Delete')}
          </Button>
        </Popconfirm>
      </div>
    </div>
  )
}

export default ChannelListItem
