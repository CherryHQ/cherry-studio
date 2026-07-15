import { Button, Center, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, Spinner } from '@cherrystudio/ui'
import { ResourceCatalogSearchInput } from '@renderer/components/resourceCatalog/ResourceCatalogSearchInput'
import { useSystemSkills } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import type { SystemSkillCandidate } from '@shared/types/skill'
import { Check, Download, FolderSearch, Loader2, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type BaseProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Props = BaseProps &
  (
    | { mode: 'manage'; onEnabled?: never; selectedSkillIds?: never }
    | { mode: 'agent-create'; onEnabled: (skillId: string) => void; selectedSkillIds: readonly string[] }
  )

export function SystemSkillDialog({ mode, open, onOpenChange, onEnabled, selectedSkillIds }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const { skills, loading, error, importSkill, importing } = useSystemSkills(open)
  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return skills

    return skills.filter((skill) =>
      [skill.name, skill.description].some((value) => value?.toLowerCase().includes(normalizedQuery))
    )
  }, [query, skills])

  const handleImport = useCallback(
    async (skill: SystemSkillCandidate) => {
      const installed = await importSkill(skill)
      if (installed) toast.success(t('library.system_skill.import_success', { name: skill.name }))
    },
    [importSkill, t]
  )

  const handleEnable = useCallback(
    (skill: SystemSkillCandidate) => {
      if (mode !== 'agent-create' || !skill.registeredSkillId) return
      onEnabled(skill.registeredSkillId)
      toast.success(t('library.system_skill.enable_success', { name: skill.name }))
    },
    [mode, onEnabled, t]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeOnOverlayClick
        size="xl"
        className="flex h-[min(640px,82vh)] flex-col gap-0 overflow-hidden p-0"
        data-testid="system-skill-dialog">
        <div className="shrink-0 border-border-muted border-b px-6 pt-5 pb-4">
          <DialogHeader className="min-w-0 text-left">
            <DialogTitle>{t('library.system_skill.title')}</DialogTitle>
            <p className="mt-1 text-foreground-muted text-xs">{t('library.system_skill.description')}</p>
          </DialogHeader>
          <ResourceCatalogSearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('library.system_skill.search_placeholder')}
            className="mt-3"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {loading && skills.length === 0 ? (
            <Center className="min-h-0 flex-1 text-foreground-muted text-sm">
              <Spinner text={t('common.loading')} />
            </Center>
          ) : error ? (
            <EmptyState preset="no-result" title={t('common.error')} description={error} className="min-h-0 flex-1" />
          ) : skills.length === 0 ? (
            <EmptyState
              preset="no-resource"
              title={t('library.system_skill.empty_title')}
              description={t('library.system_skill.empty_description')}
              className="min-h-0 flex-1"
            />
          ) : visibleSkills.length === 0 ? (
            <EmptyState preset="no-result" title={t('common.no_results')} className="min-h-0 flex-1" />
          ) : (
            <div role="list" className="min-h-0 flex-1 overflow-y-auto px-6 py-1">
              {visibleSkills.map((skill) => (
                <SystemSkillRow
                  key={skill.id}
                  skill={skill}
                  mode={mode}
                  importing={importing.has(skill.id)}
                  selected={Boolean(skill.registeredSkillId && selectedSkillIds?.includes(skill.registeredSkillId))}
                  onImport={() => void handleImport(skill)}
                  onEnable={() => handleEnable(skill)}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SystemSkillRow({
  skill,
  mode,
  importing,
  selected,
  onImport,
  onEnable
}: {
  skill: SystemSkillCandidate
  mode: 'manage' | 'agent-create'
  importing: boolean
  selected: boolean
  onImport: () => void
  onEnable: () => void
}) {
  const { t } = useTranslation()
  const placementNames = Array.from(new Set(skill.placements.map((placement) => placement.sourceName))).join(', ')
  const imported = skill.status === 'registered'
  const enabled = mode === 'agent-create' && selected
  const disabled = importing || skill.status === 'conflict' || (mode === 'manage' ? imported : enabled)
  const buttonLabel =
    skill.status === 'conflict'
      ? t('library.system_skill.conflict')
      : skill.status === 'available'
        ? t('library.system_skill.import')
        : mode === 'manage'
          ? t('library.system_skill.imported')
          : enabled
            ? t('library.system_skill.enabled')
            : t('library.action.enable')
  const onClick = skill.status === 'available' ? onImport : onEnable

  return (
    <div
      role="listitem"
      className="flex min-h-20 items-center gap-4 border-border-muted border-b px-2 py-3 last:border-b-0">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground-muted">
        {skill.status === 'conflict' ? <TriangleAlert className="size-4" /> : <FolderSearch className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[13px] text-foreground">{skill.name}</span>
          <span className="shrink-0 text-foreground-muted text-xs">{placementNames}</span>
        </div>
        {skill.description ? (
          <p className="mt-0.5 truncate text-foreground-muted text-xs">{skill.description}</p>
        ) : null}
        <p className="mt-1 truncate font-mono text-[11px] text-foreground-muted">{skill.directoryPath}</p>
      </div>
      <Button variant="outline" size="sm" disabled={disabled} onClick={onClick} className="shrink-0">
        {importing ? (
          <Loader2 className="size-3 animate-spin" />
        ) : imported || enabled ? (
          <Check className="size-3" />
        ) : (
          <Download className="size-3" />
        )}
        {buttonLabel}
      </Button>
    </div>
  )
}
