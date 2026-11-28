import { useTranslation } from 'react-i18next'

import { ApiGatewayContent } from '@renderer/components/ApiGatewayPanel'

const ApiGatewaySettings = () => {
  const { t } = useTranslation()
  return (
    <ApiGatewayContent title={t('apiGateway.title')} className="flex h-[calc(100vh-var(--navbar-height))] flex-col" />
  )
}

export default ApiGatewaySettings
