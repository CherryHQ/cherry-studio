import { useTranslation } from 'react-i18next'

import type { McpServer } from '@shared/data/types/mcpServer'

export type PreviewServer = Pick<McpServer, 'baseUrl' | 'command' | 'args' | 'env' | 'headers'>

export const getCommandPreview = (server: Pick<McpServer, 'command' | 'args'>): string => {
  return [server.command, ...(server.args ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
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

export const McpServerConfigPreview = ({ server }: { server: PreviewServer }) => {
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

export const ProtocolInstallWarningContent = ({ message, server }: { message: string; server: PreviewServer }) => {
  return (
    <div className="space-y-3 text-left">
      <p>{message}</p>
      <McpServerConfigPreview server={server} />
    </div>
  )
}

export const McpImportTrustWarningContent = ({
  message,
  servers
}: {
  message: string
  servers: Array<Pick<McpServer, 'id' | 'name'> & PreviewServer>
}) => {
  if (servers.length === 1) {
    return <ProtocolInstallWarningContent message={message} server={servers[0]} />
  }

  return (
    <div className="space-y-3 text-left">
      <p>{message}</p>
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {servers.map((server) => (
          <div key={server.id} className="space-y-2 rounded-md border border-border p-3">
            <div className="font-medium">{server.name}</div>
            <McpServerConfigPreview server={server} />
          </div>
        ))}
      </div>
    </div>
  )
}
