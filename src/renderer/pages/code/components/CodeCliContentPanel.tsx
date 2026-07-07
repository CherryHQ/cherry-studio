import { Button } from '@cherrystudio/ui'
import { openSettingsTab } from '@renderer/services/settingsNavigation'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { CircleAlert, ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { CodeToolMeta, VersionStatus } from '../types/codeCli'
import { ConfigList } from './ConfigList'
import { VersionStatusCard } from './VersionStatusCard'

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
  }
  installingTools: Set<string>
  upgradingTools: Set<string>
  providerState: {
    providerless: boolean
    showSelectionHint: boolean
  }
  supportedProviders: Provider[]
  providerConfigs: Record<string, CliProviderConfig>
  currentProviderId: string | null
  currentProviderModelName?: string
  resolveProviderMeta: (provider: Provider, cfg?: CliProviderConfig) => { providerName: string; modelName?: string }
  onInstall: () => void
  onUpgrade: () => void
  onRemove: () => void
  onLaunch: () => void
  onStop: () => void
  onOpenDashboard: () => void
  onConfigure: (provider: Provider) => void
  onToggleCurrent: (provider: Provider) => void
  onReorder: (nextProviders: Provider[]) => void | Promise<void>
}

function getAddProviderHintKey(cliTool: CodeCli): string {
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      return 'code.add_provider_hint_anthropic_messages'
    case CodeCli.OPENAI_CODEX:
      return 'code.add_provider_hint_openai_responses'
    case CodeCli.GEMINI_CLI:
      return 'code.add_provider_hint_gemini'
    default:
      return 'code.add_provider_hint'
  }
}

export const CodeCliContentPanel: FC<CodeCliContentPanelProps> = ({
  selectedCliTool,
  activeMeta,
  versionStatus,
  versionCard,
  installingTools,
  upgradingTools,
  providerState,
  supportedProviders,
  providerConfigs,
  currentProviderId,
  currentProviderModelName,
  resolveProviderMeta,
  onInstall,
  onUpgrade,
  onRemove,
  onLaunch,
  onStop,
  onOpenDashboard,
  onConfigure,
  onToggleCurrent,
  onReorder
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-y-auto px-6 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto max-w-2xl space-y-5">
        {versionCard.visible && (
          <VersionStatusCard
            toolId={selectedCliTool}
            toolName={activeMeta.label}
            status={versionStatus}
            onInstall={onInstall}
            onUpgrade={onUpgrade}
            onRemove={onRemove}
            onLaunch={onLaunch}
            onStop={onStop}
            onOpenDashboard={onOpenDashboard}
            canLaunch={versionCard.canLaunch}
            launching={versionCard.launching}
            running={versionCard.running}
            stopping={versionCard.stopping}
            isInstalling={installingTools.has(selectedCliTool)}
            isUpgrading={upgradingTools.has(selectedCliTool)}
          />
        )}

        {providerState.showSelectionHint && (
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning text-xs">
            <CircleAlert className="size-3.5 shrink-0" />
            <span>{t('code.select_provider_before_launch', { toolName: activeMeta.label })}</span>
          </div>
        )}

        {providerState.providerless ? (
          <div className="rounded-lg border border-border/40 bg-accent/10 px-4 py-3 text-muted-foreground text-xs">
            {t('code.providerless_hint')}
          </div>
        ) : (
          <>
            <ConfigList
              selectedCliTool={selectedCliTool}
              toolName={activeMeta.label}
              providers={supportedProviders}
              providerConfigs={providerConfigs}
              currentProviderId={currentProviderId}
              currentProviderModelName={currentProviderModelName}
              resolveMeta={resolveProviderMeta}
              onConfigure={onConfigure}
              onToggleCurrent={onToggleCurrent}
              onReorder={onReorder}
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openSettingsTab('/settings/provider')}
              className="w-full rounded-xl border-border-subtle border-dashed py-2 text-foreground-secondary hover:border-border hover:text-foreground">
              {t(getAddProviderHintKey(selectedCliTool))}
              <ExternalLink size={10} />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
