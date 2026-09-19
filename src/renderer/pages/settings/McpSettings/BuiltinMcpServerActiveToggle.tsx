import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useMcpServerMutations } from '@renderer/hooks/useMcpServer'
import { toast } from '@renderer/services/toast'

const logger = loggerService.withContext('BuiltinMcpServerActiveToggle')

interface Props {
  serverId: string
  isActive: boolean
}

/**
 * Switch an installed builtin server on or off from the catalogue row.
 *
 * The seeder installs these inactive, so "Installed" on its own read as "working" for a
 * capability that was doing nothing — `@cherry/browser` sat there switched off with a green
 * check beside it. The row now says which it is, and lets it be changed here.
 */
export function BuiltinMcpServerActiveToggle({ serverId, isActive }: Props) {
  const { t } = useTranslation()
  const { updateMcpServer } = useMcpServerMutations(serverId)
  const [saving, setSaving] = useState(false)

  const handleChange = useCallback(
    async (next: boolean) => {
      setSaving(true)
      try {
        await updateMcpServer({ body: { isActive: next } })
      } catch (error) {
        logger.error('Failed to switch builtin MCP server', { serverId, error })
        toast.error(t('settings.mcp.builtin.toggle_failed'))
      } finally {
        setSaving(false)
      }
    },
    [serverId, t, updateMcpServer]
  )

  const label = isActive ? t('settings.mcp.builtin.on') : t('settings.mcp.builtin.off')

  return (
    <Tooltip content={t('settings.mcp.builtin.toggle_tip')}>
      <span className="inline-flex h-7 items-center gap-2 px-1 text-xs">
        <span className={isActive ? 'text-success' : 'text-muted-foreground'}>{label}</span>
        <Switch
          size="xs"
          checked={isActive}
          disabled={saving}
          aria-label={t('settings.mcp.builtin.toggle_tip')}
          onCheckedChange={(checked) => void handleChange(checked)}
        />
      </span>
    </Tooltip>
  )
}
