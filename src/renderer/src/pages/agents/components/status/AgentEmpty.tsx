import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import AgentStatusScreen from './AgentStatusScreen'

const AgentEmpty = () => {
  const { t } = useTranslation()

  return (
    <AgentStatusScreen
      icon={Bot}
      iconClassName="text-(--color-text-secondary)"
      title={t('agent.empty.title')}
      description={t('agent.empty.description')}
    />
  )
}

export default AgentEmpty
