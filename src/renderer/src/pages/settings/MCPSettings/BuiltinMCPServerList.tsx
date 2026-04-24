import { Button } from '@cherrystudio/ui'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { getBuiltInMcpServerDescriptionLabel, getMcpTypeLabel } from '@renderer/i18n/label'
import { builtinMCPServers } from '@renderer/store/mcp'
import { Popover, Tag } from 'antd'
import { Check, Plus } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '..'

const BuiltinMCPServerList: FC = () => {
  const { t } = useTranslation()
  const { addMCPServer, mcpServers } = useMCPServers()

  return (
    <>
      <SettingTitle style={{ gap: 3, marginBottom: 10 }}>{t('settings.mcp.builtinServers')}</SettingTitle>
      <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {builtinMCPServers.map((server) => {
          const isInstalled = mcpServers.some((existingServer) => existingServer.name === server.name)

          return (
            <div
              key={server.id}
              className="flex h-31.25 cursor-default flex-col rounded-lg border border-border bg-card px-4 py-2.5 transition-all duration-200 ease-in-out hover:border-primary dark:bg-white/6">
              <div className="mb-1.25 flex items-center">
                <div className="flex flex-1 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  <span className="font-medium text-[15px]">{server.name}</span>
                </div>
                <div className="ml-2 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={async () => {
                      if (isInstalled) {
                        return
                      }

                      try {
                        await addMCPServer(server)
                        window.toast.success(t('settings.mcp.addSuccess'))
                      } catch {
                        window.toast.error(t('settings.mcp.addError'))
                      }
                    }}
                    disabled={isInstalled}>
                    {isInstalled ? <Check size={16} className="text-primary" /> : <Plus size={16} />}
                  </Button>
                </div>
              </div>
              <Popover
                content={
                  <div className="wrap-break-word max-w-87.5 whitespace-pre-wrap text-(--color-foreground) text-[14px] leading-normal">
                    {getBuiltInMcpServerDescriptionLabel(server.name)}
                    {server.reference && (
                      <a
                        href={server.reference}
                        className="wrap-break-word mt-2 inline-block max-w-87.5 text-(--color-primary) no-underline hover:text-(--color-primary-hover) hover:underline">
                        {server.reference}
                      </a>
                    )}
                  </div>
                }
                title={server.name}
                trigger="hover"
                placement="topLeft"
                overlayStyle={{ maxWidth: 400 }}>
                <div className="wrap-break-word relative line-clamp-2 w-full cursor-pointer text-(--color-foreground-secondary) text-[12px] hover:text-(--color-foreground)">
                  {getBuiltInMcpServerDescriptionLabel(server.name)}
                </div>
              </Popover>
              <div className="mt-2.5 flex items-center justify-start gap-1">
                <Tag color="processing" style={{ borderRadius: 20, margin: 0, fontWeight: 500 }}>
                  {getMcpTypeLabel(server.type ?? 'stdio')}
                </Tag>
                {server?.shouldConfig && (
                  <a
                    href="https://docs.cherry-ai.com/advanced-basic/mcp/buildin"
                    target="_blank"
                    rel="noopener noreferrer">
                    <Tag color="warning" style={{ borderRadius: 20, margin: 0, fontWeight: 500 }}>
                      {t('settings.mcp.requiresConfig')}
                    </Tag>
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default BuiltinMCPServerList
