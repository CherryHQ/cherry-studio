import { ArrowUpCircle, Download, ExternalLink, Loader2, Play, Settings2, Square, Trash2 } from 'lucide-react'
import { type ComponentProps, type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, InputGroup, InputGroupAddon, Scrollbar, Tooltip } from '@cherrystudio/ui'
import { BinaryInstallErrorDialog } from '@renderer/components/BinaryInstallErrorDialog'
import { LocalAgentIcon } from '@renderer/components/icons/LocalAgentIcon'
import { AgentServiceCard } from '@renderer/components/localAgent/AgentServiceCard'
import { LocalAgentModelList } from '@renderer/components/localAgent/LocalAgentModelList'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { CODE_CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import type { CodeCli } from '@shared/types/codeCli'

import type { CodeToolMeta, VersionStatus } from '../types'

interface CodeCliContentPanelProps {
  selectedCliTool: CodeCli
  activeMeta: CodeToolMeta
  versionStatus: VersionStatus
  versionCard: {
    visible: boolean
    canLaunch: boolean
    launching: boolean
    running: boolean
    stopping: boolean
    upgradeDisabled: boolean
  }
  installingTools: Set<string>
  upgradingTools: Set<string>
  installError?: string
  modelList: ComponentProps<typeof LocalAgentModelList>
  onConfigureCurrent?: () => void
  onInstall: () => void
  onUpgrade: () => void
  onRemove?: () => void
  onLaunch: () => void
  onStop: () => void
  onOpenDashboard: () => void
}

export const CodeCliContentPanel: FC<CodeCliContentPanelProps> = ({
  selectedCliTool,
  activeMeta,
  versionStatus,
  versionCard,
  installingTools,
  upgradingTools,
  installError,
  modelList,
  onConfigureCurrent,
  onInstall,
  onUpgrade,
  onRemove,
  onLaunch,
  onStop,
  onOpenDashboard
}) => {
  const { t } = useTranslation()
  const [showInstallError, setShowInstallError] = useState(false)
  useEffect(() => setShowInstallError(false), [selectedCliTool])
  const busy =
    installingTools.has(selectedCliTool) ||
    upgradingTools.has(selectedCliTool) ||
    versionStatus.operation?.status === 'removing'
  const program =
    versionStatus.resolvedPath ?? versionStatus.systemPath ?? CODE_CLI_TOOL_PRESET_MAP[selectedCliTool].executable
  const iconClass = 'lucide-custom size-3.5 text-muted-foreground'
  const retryInstall =
    (versionStatus.operation?.status === 'failed' && versionStatus.operation.action === 'install') ||
    versionStatus.applicationStatus === 'broken' ||
    versionStatus.applicationStatus === 'unknown'

  return (
    <>
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden px-6 pt-3 pb-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <AgentServiceCard
            title={activeMeta.label}
            icon={<LocalAgentIcon cliId={selectedCliTool} size={36} />}
            version={versionStatus.current}
            controls={
              <>
                <Tooltip content={t('common.advanced_settings')} asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 rounded-lg"
                    aria-label={t('common.advanced_settings')}
                    disabled={busy || modelList.disabled || !onConfigureCurrent}
                    onClick={onConfigureCurrent}>
                    <Settings2 className={iconClass} />
                  </Button>
                </Tooltip>
              </>
            }
            actions={
              <>
                {(!versionStatus.installed || retryInstall) && (
                  <Button variant="outline" size="sm" className="h-8" onClick={onInstall} disabled={busy}>
                    {busy ? <Loader2 className={`${iconClass} animate-spin`} /> : <Download className={iconClass} />}
                    {t(retryInstall ? 'common.retry' : 'code.install')}
                  </Button>
                )}
                {versionStatus.installed && (
                  <>
                    {versionStatus.canUpgrade && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={onUpgrade}
                        disabled={busy || versionCard.upgradeDisabled}>
                        <ArrowUpCircle className={iconClass} />
                        {t('code.upgrade')}
                      </Button>
                    )}
                    {onRemove && (
                      <Tooltip content={t('local_agents.uninstall')} asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t('local_agents.uninstall')}
                          onClick={onRemove}
                          disabled={busy || versionCard.launching || versionCard.stopping}>
                          <Trash2 className={iconClass} />
                        </Button>
                      </Tooltip>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={versionCard.running ? onStop : onLaunch}
                      disabled={
                        busy ||
                        versionCard.launching ||
                        versionCard.stopping ||
                        (!versionCard.running && !versionCard.canLaunch) ||
                        (modelList.disabled && !versionCard.running)
                      }>
                      {versionCard.launching || versionCard.stopping ? (
                        <Loader2 className={`${iconClass} animate-spin`} />
                      ) : versionCard.running ? (
                        <Square className={iconClass} />
                      ) : (
                        <Play className={iconClass} />
                      )}
                      {t(versionCard.running ? 'code.stop' : 'code.launch.label')}
                    </Button>
                    {versionCard.running && (
                      <Button variant="outline" size="sm" className="h-8" onClick={onOpenDashboard}>
                        <ExternalLink className={iconClass} />
                        {t('code.open_web_ui')}
                      </Button>
                    )}
                  </>
                )}
              </>
            }>
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="h-8 min-w-40 flex-1 rounded-lg border-border-subtle bg-muted/30 shadow-none">
                <span className="min-w-0 flex-1 truncate px-3 text-left font-mono text-xs" dir="rtl" title={program}>
                  <bdi dir="ltr">{program}</bdi>
                </span>
                <InputGroupAddon align="inline-end" className="gap-2 pr-2">
                  <Badge variant="secondary" className="rounded-full text-[10px]">
                    {t(versionStatus.installed ? 'local_agents.detected' : 'local_agents.not_installed')}
                  </Badge>
                </InputGroupAddon>
              </InputGroup>
            </div>
            {installError && (
              <Button variant="link" className="h-auto p-0 text-destructive" onClick={() => setShowInstallError(true)}>
                {t('common.error')}
              </Button>
            )}
          </AgentServiceCard>
          <LocalAgentModelList {...modelList} />
          <Button
            variant="outline"
            size="sm"
            className="border-dashed"
            onClick={() => openSettingsTab('/settings/provider')}>
            {t('code.add_provider_hint')}
            <ExternalLink className={iconClass} />
          </Button>
        </div>
      </Scrollbar>
      <BinaryInstallErrorDialog
        error={
          showInstallError && installError ? { name: activeMeta.label, message: installError, action: 'install' } : null
        }
        onOpenChange={(open) => !open && setShowInstallError(false)}
      />
    </>
  )
}
