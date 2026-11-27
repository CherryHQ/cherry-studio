import { useTranslation } from 'react-i18next'

import { ScrollArea } from '@cherrystudio/ui'
import ApiGatewayPanel from '@renderer/components/ApiGatewayPanel'

export default function ApiGatewayPage() {
  const { t } = useTranslation()
  return (
    <div data-ui="api-gateway.view" className="flex h-full min-h-0 flex-col bg-background">
      <ScrollArea viewportProps={{ className: 'overflow-x-hidden' }} className="min-h-0 flex-1">
        <div className="mx-auto w-full min-w-0 max-w-2xl px-4 py-6 sm:px-8 sm:py-8">
          <ApiGatewayPanel
            renderHeader={(controls) => (
              <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h1 className="min-w-0 text-2xl leading-tight font-semibold tracking-tight wrap-anywhere">
                  {t('code.api_gateway.title')}
                </h1>
                {controls}
              </header>
            )}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
