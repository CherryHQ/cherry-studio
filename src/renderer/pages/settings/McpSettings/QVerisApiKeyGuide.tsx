import { Trans } from 'react-i18next'

import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

export const QVERIS_API_KEY_REGISTRATION_URL = 'https://qveris.ai'

export const isQVerisApiKeyMissing = (server: Pick<McpServer, 'name' | 'env'>): boolean => {
  return server.name === BuiltinMcpServerNames.qveris && !server.env?.QVERIS_API_KEY?.trim()
}

export const QVerisApiKeyGuide = () => (
  <Trans
    i18nKey="settings.mcp.qveris.missing_api_key"
    components={{
      link: (
        <a
          href={QVERIS_API_KEY_REGISTRATION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:underline"
        />
      )
    }}
  />
)
