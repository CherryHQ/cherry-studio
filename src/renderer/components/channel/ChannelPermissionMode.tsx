import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { FullAccessConfirmDialog, PermissionModeSelectItem } from '@renderer/components/PermissionModeOption'
import { permissionModeCards } from '@renderer/utils/agent'

import type { ChannelFormProps } from './channelTypes'

const INHERIT_PERMISSION_MODE_VALUE = '__inherit'

export function ChannelPermissionMode({
  channel,
  onConfigChange,
  agentPermissionMode,
  permissionModes
}: ChannelFormProps) {
  const { t } = useTranslation()
  const selectedCard = permissionModeCards.find((card) => card.mode === channel.permissionMode)
  const agentCard = permissionModeCards.find((card) => card.mode === agentPermissionMode)
  const cards = permissionModes
    ? permissionModeCards.filter((card) => permissionModes.includes(card.mode))
    : permissionModeCards
  const inheritLabel = agentCard
    ? t('agent.channels.security.inheritFromAgentMode', { mode: t(agentCard.titleKey, agentCard.titleFallback) })
    : t('agent.channels.security.inheritFromAgent')
  const [fullAccessPending, setFullAccessPending] = useState(false)

  // Any newer mode (local or from another window) wins; confirming must never apply a stale dialog.
  useEffect(() => {
    setFullAccessPending(false)
  }, [channel.permissionMode])

  return (
    <div className="flex flex-col gap-1">
      <Label className="font-normal text-xs">{t('agent.channels.security.permissionMode')}</Label>
      <Select
        value={channel.permissionMode ?? INHERIT_PERMISSION_MODE_VALUE}
        onValueChange={(value) => {
          // Radix's hidden native select can briefly emit an empty value while its dynamic options change.
          if (!value) return
          if (value === 'bypassPermissions') {
            // Already Full Access: nothing to confirm.
            if (channel.permissionMode !== 'bypassPermissions') setFullAccessPending(true)
            return
          }
          setFullAccessPending(false)
          onConfigChange({
            permissionMode: value === INHERIT_PERMISSION_MODE_VALUE ? null : value
          })
        }}>
        <SelectTrigger size="sm" className="w-full" aria-label={t('agent.channels.security.permissionMode')}>
          {/* Own children so the trigger stays one line: the items below can be two. */}
          <SelectValue>
            {selectedCard ? (
              <span className={selectedCard.dangerous ? 'text-destructive' : undefined}>
                {t(selectedCard.titleKey, selectedCard.titleFallback)}
              </span>
            ) : (
              inheritLabel
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT_PERMISSION_MODE_VALUE}>{inheritLabel}</SelectItem>
          {cards.map((card) => (
            <PermissionModeSelectItem key={card.mode} card={card} compact t={t} />
          ))}
        </SelectContent>
      </Select>
      <FullAccessConfirmDialog
        open={fullAccessPending}
        onOpenChange={setFullAccessPending}
        onConfirm={() => onConfigChange({ permissionMode: 'bypassPermissions' })}
        scopeName={channel.name.trim() || undefined}
        scopeKind="channel"
        t={t}
      />
    </div>
  )
}
