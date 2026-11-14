import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

/** The stored Vertex AI sign-in that applying a setup link would replace. */
export type VertexSetupReplacement = 'service_account' | 'google'

interface Props {
  project: string
  location: string
  clientId: string
  replaces: VertexSetupReplacement | null
}

/** Confirmation body for a Vertex AI setup link: the settings it applies and what it replaces. */
const VertexGoogleSetupSummary: FC<Props> = ({ project, location, clientId, replaces }) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{t('settings.provider.vertex_ai.setup_link.description')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
        <dt className="text-muted-foreground">{t('settings.provider.vertex_ai.project_id')}</dt>
        <dd>{project}</dd>
        <dt className="text-muted-foreground">{t('settings.provider.vertex_ai.location')}</dt>
        <dd>{location}</dd>
        <dt className="text-muted-foreground">{t('settings.provider.vertex_ai.google.client_id')}</dt>
        <dd>{clientId}</dd>
      </dl>
      {replaces && (
        <p className="text-warning">
          {replaces === 'google'
            ? t('settings.provider.vertex_ai.setup_link.replace_google')
            : t('settings.provider.vertex_ai.setup_link.replace_service_account')}
        </p>
      )}
      <p className="text-muted-foreground">{t('settings.provider.vertex_ai.setup_link.trust_warning')}</p>
    </div>
  )
}

export default VertexGoogleSetupSummary
