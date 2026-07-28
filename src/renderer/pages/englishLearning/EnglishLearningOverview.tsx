import { Button, Skeleton } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { useNavigate } from '@tanstack/react-router'
import { BookOpen, Brain, Mic2, TimerReset } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function EnglishLearningOverview() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery('/english-learning/dashboard')

  if (isLoading || !data) return <Skeleton className="h-56 w-full rounded-xl" />

  const metrics = [
    { icon: Brain, label: t('english_learning.overview.units'), value: data.unitTotal },
    { icon: BookOpen, label: t('english_learning.overview.due'), value: data.dueNowTotal },
    { icon: TimerReset, label: t('english_learning.overview.reviewed'), value: data.reviewedTodayTotal },
    { icon: Mic2, label: t('english_learning.overview.practice_minutes'), value: data.practiceMinutesToday }
  ]
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-bold text-2xl">{t('english_learning.overview.heading')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('english_learning.overview.description')}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <Icon className="size-4 text-muted-foreground" />
            <div className="mt-4 font-bold text-3xl">{value}</div>
            <div className="mt-1 text-muted-foreground text-sm">{label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-medium text-lg">{t('english_learning.overview.today')}</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {t('english_learning.overview.today_description', { count: data.dueNowTotal })}
        </p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => void navigate({ to: '/app/english-learning/review' })}>
            {t('english_learning.actions.start_review')}
          </Button>
          <Button variant="outline" onClick={() => void navigate({ to: '/app/english-learning/speaking' })}>
            {t('english_learning.actions.practice_speaking')}
          </Button>
        </div>
      </div>
    </div>
  )
}
