import { Button } from '@cherrystudio/ui'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { BookOpen, Library, Mic2, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const navigation = [
  { suffix: '', icon: BookOpen, label: 'english_learning.navigation.overview' },
  { suffix: '/review', icon: BookOpen, label: 'english_learning.navigation.review' },
  { suffix: '/speaking', icon: Mic2, label: 'english_learning.navigation.speaking' },
  { suffix: '/library', icon: Library, label: 'english_learning.navigation.library' },
  { suffix: '/settings', icon: Settings2, label: 'english_learning.navigation.settings' }
] as const

export function EnglishLearningLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <aside className="w-[220px] shrink-0 border-border border-r bg-sidebar px-2 py-3">
        <div className="flex h-8 items-center px-3 font-medium text-sm">{t('english_learning.title')}</div>
        <nav className="mt-3 flex flex-col gap-1">
          {navigation.map(({ suffix, icon: Icon, label }) => {
            const target = `/app/english-learning${suffix}`
            const active = suffix ? pathname === target : pathname === '/app/english-learning'
            return (
              <Button
                key={target}
                variant="ghost"
                className={`h-8 justify-start gap-3 rounded-[10px] px-3 ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}`}
                onClick={() => void navigate({ to: target })}>
                <Icon className="size-4" />
                {t(label)}
              </Button>
            )
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  )
}
