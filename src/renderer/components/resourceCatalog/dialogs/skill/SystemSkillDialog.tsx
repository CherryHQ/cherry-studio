import { Button, Center, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, Spinner } from '@cherrystudio/ui'
import { ResourceCatalogSearchInput } from '@renderer/components/resourceCatalog/ResourceCatalogSearchInput'
import { useSystemSkills } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import type { InstalledSkill, SystemSkillCandidate } from '@shared/types/skill'
import { Check, Download, FolderSearch, Loader2, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  agentId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRegistered?: (skill: InstalledSkill) => void
}

export function SystemSkillDialog({ agentId, open, onOpenChange, onRegistered }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const { skills, loading, error, register, registering } = useSystemSkills(agentId, open)
  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return skills

    return skills.filter((skill) =>
      [skill.name, skill.description].some((value) => value?.toLowerCase().includes(normalizedQuery))
    )
  }, [query, skills])

  const handleRegister = useCallback(
    async (skill: SystemSkillCandidate) => {
      const installed = await register(skill)
      if (!installed) return
      toast.success(t('library.system_skill.import_success', { name: installed.name }))
      onRegistered?.(installed)
    },
    [onRegistered, register, t]
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
                  registering={registering.has(skill.id)}
                  onRegister={() => void handleRegister(skill)}
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
  registering,
  onRegister
}: {
  skill: SystemSkillCandidate
  registering: boolean
  onRegister: () => void
}) {
  const { t } = useTranslation()
  const placementNames = Array.from(new Set(skill.placements.map((placement) => placement.sourceName))).join(', ')
  const imported = skill.status === 'enabled'
  const disabled = registering || imported || skill.status === 'conflict'
  const buttonLabel = imported
    ? t('library.system_skill.imported')
    : skill.status === 'conflict'
      ? t('library.system_skill.conflict')
      : t('library.system_skill.import')

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
      <Button variant="outline" size="sm" disabled={disabled} onClick={onRegister} className="shrink-0">
        {registering ? (
          <Loader2 className="size-3 animate-spin" />
        ) : imported ? (
          <Check className="size-3" />
        ) : (
          <Download className="size-3" />
        )}
        {buttonLabel}
      </Button>
    </div>
  )
}
