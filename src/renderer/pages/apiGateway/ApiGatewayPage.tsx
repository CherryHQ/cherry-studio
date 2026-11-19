import { useTranslation } from 'react-i18next'

import { PageHeader, ScrollArea } from '@cherrystudio/ui'
import ApiGatewayPanel from '@renderer/components/apiGateway/ApiGatewayPanel'

export default function ApiGatewayPage() {
  const { t } = useTranslation()
  return (
    <div data-ui="api-gateway.view" className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader bordered className="my-0 h-10.5" title={t('code.api_gateway.title')} />
      <ScrollArea viewportProps={{ className: 'overflow-x-hidden' }} className="min-h-0 flex-1">
        <main className="mx-auto w-full min-w-0 max-w-3xl px-6 py-6">
          <ApiGatewayPanel />
        </main>
      </ScrollArea>
    </div>
  )
}
