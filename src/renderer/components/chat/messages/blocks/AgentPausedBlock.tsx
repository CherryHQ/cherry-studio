import { useTranslation } from 'react-i18next'

/** A paused turn can legitimately have no assistant text; keep its state visible in history. */
export default function AgentPausedBlock() {
  const { t } = useTranslation()
  return (
    <div className="my-1 rounded-md border border-border-subtle bg-background-subtle px-3 py-2 text-sm text-muted-foreground">
      {t('agent.session.paused_empty')}
    </div>
  )
}
