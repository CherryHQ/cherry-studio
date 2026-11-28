import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Switch } from '@cherrystudio/ui'
import type { useMcpServer } from '@renderer/hooks/useMcpServer'
import { useMcpSkills } from '@renderer/hooks/useMcpSkills'
import { toast } from '@renderer/services/toast'
import type { McpServer, McpSkillPermission } from '@shared/data/types/mcpServer'

import McpPermissionTable from './McpPermissionTable'

export default function McpSkillsSection({
  server,
  updateMcpServer
}: {
  server: McpServer
  updateMcpServer: ReturnType<typeof useMcpServer>['updateMcpServer']
}) {
  const { t } = useTranslation()
  const catalog = useMcpSkills([server.id], true, true)[0]
  const [saving, setSaving] = useState(false)
  const changePermission = async (uri: string, permission: McpSkillPermission) => {
    setSaving(true)
    try {
      await updateMcpServer({ body: { skillPermissions: { ...server.skillPermissions, [uri]: permission } } })
    } catch {
      toast.error(t('settings.mcp.updateError'))
    } finally {
      setSaving(false)
    }
  }
  if (!catalog) return <div role="status">{t('common.loading')}</div>
  if (catalog.error) return <Alert type="error" message={t('mcp.skills.unavailable')} description={catalog.error} />
  return (
    <McpPermissionTable
      data={catalog.skills.map((skill) => ({
        id: skill.uri,
        name: skill.frontmatter.name,
        description: skill.frontmatter.description
      }))}
      nameLabel={t('plugins.skills')}
      enableLabel={t('common.enabled')}
      emptyText={t('settings.mcp.skills.empty')}
      disabled={saving}
      isEnabled={(skill) => server.skillPermissions?.[skill.id] !== 'disabled'}
      onToggleEnabled={(skill, enabled) => void changePermission(skill.id, enabled ? 'prompt' : 'disabled')}
      renderAutoApprove={(skill) => (
        <Switch
          size="xs"
          aria-label={`${t('settings.mcp.tools.autoApprove.label')}: ${skill.name}`}
          checked={server.skillPermissions?.[skill.id] === 'auto'}
          disabled={saving || server.skillPermissions?.[skill.id] === 'disabled'}
          onCheckedChange={(autoApprove) => void changePermission(skill.id, autoApprove ? 'auto' : 'prompt')}
        />
      )}
    />
  )
}
