import { useTranslation } from 'react-i18next'

import type { McpServer } from '@shared/data/types/mcpServer'

import { getCommandPreview } from './utils'

type PreviewServer = Pick<McpServer, 'baseUrl' | 'command' | 'args' | 'env' | 'headers'>

interface McpServerConfigPreviewProps {
  server: PreviewServer
}

const formatKeyValues = (values: Record<string, string> | undefined, separator: string) =>
  Object.entries(values ?? {})
    .map(([key, value]) => `${key}${separator}${value}`)
    .join('\n')

const PreviewField = ({ label, value }: { label: string; value: string }) =>
  value ? (
    <div className="space-y-1">
      <div className="font-semibold">{label}</div>
      <pre className="rounded-md bg-muted p-2 break-all whitespace-pre-wrap">{value}</pre>
    </div>
  ) : null

export const McpServerConfigPreview = ({ server }: McpServerConfigPreviewProps) => {
  const { t } = useTranslation()
  const connectionPreview = server.baseUrl ?? getCommandPreview(server)

  return (
    <div className="space-y-3">
      <PreviewField
        label={server.baseUrl ? t('settings.mcp.url') : t('settings.mcp.command')}
        value={connectionPreview}
      />
      <PreviewField label={t('settings.mcp.env')} value={formatKeyValues(server.env, '=')} />
      <PreviewField label={t('settings.mcp.headers')} value={formatKeyValues(server.headers, ': ')} />
    </div>
  )
}

interface ProtocolInstallWarningContentProps {
  message: string
  server: PreviewServer
}

const ProtocolInstallWarningContent = ({ message, server }: ProtocolInstallWarningContentProps) => {
  return (
    <div className="space-y-3 text-left">
      <p>{message}</p>
      <McpServerConfigPreview server={server} />
    </div>
  )
}

export default ProtocolInstallWarningContent
