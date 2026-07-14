import { Button, Center, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, Spinner } from '@cherrystudio/ui'
import { useSystemSkills } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import type { SystemSkillCandidate } from '@shared/types/skill'
import { Check, FolderSearch, Link2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  agentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRegistered?: () => void
}

export function SystemSkillDialog({ agentId, open, onOpenChange, onRegistered }: Props) {
  const { t } = useTranslation()
  const { skills, loading, error, refresh, register, registering } = useSystemSkills(agentId, open)

  const handleRegister = useCallback(
    async (skill: SystemSkillCandidate) => {
      const installed = await register(skill)
      if (!installed) return
      toast.success(t('library.system_skill.reference_enable_success', { name: installed.name }))
      onRegistered?.()
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
        <div className="flex shrink-0 items-start justify-between gap-4 border-border-muted border-b px-6 py-5">
          <DialogHeader className="min-w-0 text-left">
            <DialogTitle>{t('library.system_skill.title')}</DialogTitle>
            <p className="mt-1 text-foreground-muted text-xs">{t('library.system_skill.description')}</p>
          </DialogHeader>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            className="mr-8 shrink-0">
            <RefreshCw className={loading ? 'size-3 animate-spin' : 'size-3'} />
            {t('common.refresh')}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
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
          ) : (
            <div role="list" className="min-h-0 flex-1 overflow-y-auto px-6 py-1">
              {skills.map((skill) => (
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
  const disabled = registering || skill.status === 'enabled' || skill.status === 'conflict'
  const buttonLabel =
    skill.status === 'enabled'
      ? t('library.system_skill.enabled')
      : skill.status === 'conflict'
        ? t('library.system_skill.conflict')
        : skill.status === 'registered'
          ? t('library.system_skill.enable')
          : t('library.system_skill.reference_enable')

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
        ) : skill.status === 'enabled' ? (
          <Check className="size-3" />
        ) : (
          <Link2 className="size-3" />
        )}
        {buttonLabel}
      </Button>
    </div>
  )
}
