import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, DataTable, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import type { ColumnDef } from '@cherrystudio/ui'
import type { useMcpServer } from '@renderer/hooks/useMcpServer'
import { useMcpSkills } from '@renderer/hooks/useMcpSkills'
import { toast } from '@renderer/services/toast'
import { McpSkillPermissionSchema, type McpServer, type McpSkillPermission } from '@shared/data/types/mcpServer'
import type { McpSkillEntry } from '@shared/types/mcpSkills'

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
  const labels: Record<McpSkillPermission, string> = {
    auto: t('settings.mcp.skills.auto'),
    prompt: t('settings.mcp.skills.prompt'),
    disabled: t('settings.mcp.skills.disabled')
  }
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
  const columns: ColumnDef<McpSkillEntry>[] = [
    {
      id: 'skill',
      header: t('plugins.skills'),
      cell: ({ row: { original: skill } }) => (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium">{skill.frontmatter.name}</span>
          <p className="text-sm text-muted-foreground">{skill.frontmatter.description}</p>
          <span className="break-all text-xs text-muted-foreground">{skill.uri}</span>
        </div>
      )
    },
    {
      id: 'permission',
      header: t('settings.mcp.skills.permission'),
      meta: { width: 200, maxWidth: 200 },
      cell: ({ row: { original: skill } }) => (
        <Select
          value={server.skillPermissions?.[skill.uri] ?? 'prompt'}
          disabled={saving}
          onValueChange={(value) => void changePermission(skill.uri, McpSkillPermissionSchema.parse(value))}>
          <SelectTrigger aria-label={t('settings.mcp.skills.permission_label', { name: skill.frontmatter.name })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {McpSkillPermissionSchema.options.map((permission) => (
              <SelectItem key={permission} value={permission}>
                {labels[permission]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
  ]
  if (!catalog) return <div role="status">{t('common.loading')}</div>
  if (catalog.error) return <Alert type="error" message={t('mcp.skills.unavailable')} description={catalog.error} />
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('settings.mcp.skills.help')}</p>
      <DataTable data={catalog.skills} columns={columns} rowKey="uri" emptyText={t('settings.mcp.skills.empty')} />
    </div>
  )
}
