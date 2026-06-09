import { Badge, Dialog, DialogContent, DialogHeader, DialogTitle, Separator } from '@cherrystudio/ui'
import type { InstalledSkill } from '@types'
import type { TFunction } from 'i18next'
import { Clock, Zap } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  skill: InstalledSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function timeAgo(t: TFunction, dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('library.time_ago.just_now')
  if (mins < 60) return t('library.time_ago.minutes', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('library.time_ago.hours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('library.time_ago.days', { count: days })
  return t('library.time_ago.months', { count: Math.floor(days / 30) })
}

const SkillDetailDialog: FC<Props> = ({ skill, open, onOpenChange }) => {
  const { t } = useTranslation()

  if (!skill) return null

  const sourceTags = skill.sourceTags ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-warning-bg text-warning-text">
              <Zap size={22} strokeWidth={1.5} />
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="truncate">{skill.name}</DialogTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="border-0 bg-warning-bg px-2 py-0.5 text-warning-text text-xs">
                  {t('library.type.skill')}
                </Badge>
                <span className="text-foreground-muted text-xs">{skill.source}</span>
                {skill.author ? <span className="text-foreground-muted text-xs">{skill.author}</span> : null}
                {sourceTags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-foreground-muted text-xs">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-1">
          <Badge variant="secondary" className="gap-1.5 border-0 bg-success-bg px-2 py-0.5 text-success-text text-xs">
            <span className="size-1.5 rounded-full bg-success-base" aria-hidden="true" />
            {t('library.skill_detail.installed')}
          </Badge>
          <section className="flex flex-col gap-3">
            <h3 className="font-medium text-foreground-secondary text-sm">{t('library.skill_detail.description')}</h3>
            <p className="min-h-10 text-foreground-secondary text-sm leading-6">
              {skill.description || t('library.skill_detail.no_description')}
            </p>
          </section>

          <Separator className="bg-border-subtle" />

          <section className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground-secondary text-sm">
                {t('library.skill_detail.created_at')}
              </span>
              <div className="flex items-center gap-2 text-foreground-secondary text-sm">
                <Clock size={13} />
                <span>{formatDate(skill.createdAt)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground-secondary text-sm">
                {t('library.skill_detail.updated_at')}
              </span>
              <div className="flex items-center gap-2 text-foreground-secondary text-sm">
                <Clock size={13} />
                <span>
                  {formatDate(skill.updatedAt)} ({timeAgo(t, skill.updatedAt)})
                </span>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SkillDetailDialog
