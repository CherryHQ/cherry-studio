import { Button } from '@cherrystudio/ui'
import { WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { ChevronDown, CircleSlash, Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function AgentDefaultWorkspaceField({
  value,
  onChange
}: {
  value: string | null
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation()
  const { data: workspaces } = useQuery('/agent-workspaces')
  const selected = Array.isArray(workspaces) ? workspaces.find((workspace) => workspace.id === value) : undefined
  const label =
    selected?.name ??
    (value ? t('agent.session.workspace_selector.placeholder') : t('agent.session.workspace_selector.no_project'))

  return (
    <div className="space-y-2">
      <div className="font-medium text-sm">
        {t('common.default')} · {t('agent.session.display.workdir')}
      </div>
      <WorkspaceSelector
        value={value}
        onChange={onChange}
        align="start"
        trigger={
          <Button type="button" variant="outline" className="w-full justify-start gap-2 font-normal">
            {selected ? <Folder size={14} /> : <CircleSlash size={14} />}
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
    </div>
  )
}
