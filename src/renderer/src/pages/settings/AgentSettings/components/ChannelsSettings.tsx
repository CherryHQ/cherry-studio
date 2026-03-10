import type { CherryClawChannel, CherryClawConfiguration } from '@renderer/types'
import { Button, Empty } from 'antd'
import { type FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsTitle } from '../shared'
import ChannelFormModal from './ChannelFormModal'
import ChannelListItem from './ChannelListItem'

const ChannelsSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [formOpen, setFormOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<CherryClawChannel | null>(null)

  const config = useMemo(() => (agentBase?.configuration ?? {}) as CherryClawConfiguration, [agentBase?.configuration])
  const channels = useMemo(() => config.channels ?? [], [config.channels])

  const updateChannels = useCallback(
    (newChannels: CherryClawChannel[]) => {
      if (!agentBase) return
      update({
        id: agentBase.id,
        configuration: {
          ...config,
          channels: newChannels
        } as CherryClawConfiguration
      })
    },
    [agentBase, config, update]
  )

  const handleAdd = useCallback(() => {
    setEditingChannel(null)
    setFormOpen(true)
  }, [])

  const handleEdit = useCallback((channel: CherryClawChannel) => {
    setEditingChannel(channel)
    setFormOpen(true)
  }, [])

  const handleSave = useCallback(
    (data: Omit<CherryClawChannel, 'id'>) => {
      if (editingChannel) {
        updateChannels(channels.map((ch) => (ch.id === editingChannel.id ? { ...data, id: editingChannel.id } : ch)))
      } else {
        const id = `ch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        updateChannels([...channels, { ...data, id }])
      }
      setFormOpen(false)
      setEditingChannel(null)
    },
    [channels, editingChannel, updateChannels]
  )

  const handleToggleEnabled = useCallback(
    (channel: CherryClawChannel) => {
      updateChannels(channels.map((ch) => (ch.id === channel.id ? { ...ch, enabled: !ch.enabled } : ch)))
    },
    [channels, updateChannels]
  )

  const handleDelete = useCallback(
    (channelId: string) => {
      updateChannels(channels.filter((ch) => ch.id !== channelId))
    },
    [channels, updateChannels]
  )

  const handleCancel = useCallback(() => {
    setFormOpen(false)
    setEditingChannel(null)
  }, [])

  if (!agentBase) return null

  return (
    <SettingsContainer>
      <div className="mb-3 flex items-center justify-between">
        <SettingsTitle>{t('agent.cherryClaw.channels.title')}</SettingsTitle>
        <Button type="primary" size="small" onClick={handleAdd}>
          {t('agent.cherryClaw.channels.add', 'Add Channel')}
        </Button>
      </div>

      {channels.length === 0 ? (
        <Empty
          description={t('agent.cherryClaw.channels.empty', 'No channels configured.')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {channels.map((channel) => (
            <ChannelListItem
              key={channel.id}
              channel={channel}
              onEdit={handleEdit}
              onToggleEnabled={handleToggleEnabled}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <ChannelFormModal
        open={formOpen}
        isEdit={!!editingChannel}
        initialData={editingChannel ?? undefined}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </SettingsContainer>
  )
}

export { ChannelsSettings }
export default ChannelsSettings
