import { ListTodo } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LocalAgentPlanSchema } from '@shared/ai/localAgent'

import { TaskListView } from '../tools/agent'

export function AgentPlanBlock({ data }: { data: unknown }) {
  const { t } = useTranslation()
  const plan = LocalAgentPlanSchema.safeParse(data)
  if (!plan.success || !plan.data.entries.length) return null
  return (
    <section aria-label={t('local_agents.plan')} className="space-y-2 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <ListTodo className="size-4" />
        <span>{t('local_agents.plan')}</span>
      </div>
      <TaskListView
        tasks={plan.data.entries.map((entry, index) => ({
          id: String(index),
          subject: entry.content,
          status: entry.status
        }))}
        t={t}
      />
    </section>
  )
}
