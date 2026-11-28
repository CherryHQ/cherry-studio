import { useTranslation } from 'react-i18next'

import { ApiGatewayContent } from '@renderer/components/ApiGatewayPanel'

export default function ApiGatewayPage() {
  const { t } = useTranslation()
  return (
    <div data-ui="api-gateway.view" className="flex h-full min-h-0 flex-col bg-background">
      <ApiGatewayContent title={t('code.api_gateway.title')} innerClassName="max-w-3xl" />
    </div>
  )
}
