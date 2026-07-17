import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SegmentedControl
} from '@cherrystudio/ui'
import { GatewayIcon } from '@renderer/components/icons/GatewayIcon'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { SettingContainer, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import type { CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import type { Provider } from '@shared/data/types/provider'
import { isApiGatewayProviderId } from '@shared/types/codeCli'
import { ExternalLink } from 'lucide-react'
import type { ComponentProps, FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from './AdvancedConfigToggle'
import { CliConfigEditor } from './CliConfigEditor'
import type { ClaudeModelMode } from './types'

export interface ConfigEditDialogBodyProps {
  open: boolean
  onClose: () => void
  provider: Provider
  providerName: string
  providerIcon: ComponentProps<typeof ProviderAvatarPrimitive>['logo']
  /** Settings route opened from the header link (real provider page, or the gateway settings page). */
  providerSettingsPath: `/settings/${string}`
  theme: ComponentProps<typeof SettingContainer>['theme']
  isClaudeTool: boolean
  claudeModelMode: ClaudeModelMode
  onClaudeModelModeChange: (mode: ClaudeModelMode) => void
  modelSectionSlot: ReactNode
  toolFields: ReactNode
  advancedFields: ReactNode
  hasAdvancedSection: boolean
  advancedOpen: boolean
  onAdvancedToggle: () => void
  files: CliConfigFileDraft[]
  error?: string
  onFilesChange: (files: CliConfigFileDraft[]) => void
  submitting: boolean
  canSave: boolean
  onSubmit: () => void
}

export const ConfigEditDialogBody: FC<ConfigEditDialogBodyProps> = ({
  open,
  onClose,
  provider,
  providerName,
  providerIcon,
  providerSettingsPath,
  theme,
  isClaudeTool,
  claudeModelMode,
  onClaudeModelModeChange,
  modelSectionSlot,
  toolFields,
  advancedFields,
  hasAdvancedSection,
  advancedOpen,
  onAdvancedToggle,
  files,
  error,
  onFilesChange,
  submitting,
  canSave,
  onSubmit
}) => {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        size="lg"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            {isApiGatewayProviderId(provider.id) ? (
              // Match the gateway list card: a broadcast-tower glyph (relay/hub metaphor).
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md border border-border/30 bg-background text-foreground">
                <GatewayIcon width={14} height={14} />
              </span>
            ) : (
              <ProviderAvatarPrimitive
                providerId={provider.id}
                providerName={providerName}
                logo={providerIcon}
                size={22}
                className="shrink-0 rounded-md border border-border/30 **:data-[ui~='part:avatar-fallback']:rounded-[inherit] **:data-[ui~='part:avatar-image']:rounded-[inherit]"
              />
            )}
            <span className="min-w-0 truncate">{providerName}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground/60 hover:text-foreground"
              aria-label={t('code.open_provider_settings')}
              title={t('code.open_provider_settings')}
              onClick={() => {
                onClose()
                openSettingsTab(providerSettingsPath)
              }}>
              <ExternalLink className="size-3.5" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <SettingContainer theme={theme} style={{ background: 'transparent' }} className="gap-5 p-0">
          <SettingGroup theme={theme} className="border-t-0 pt-0">
            <div className="mb-2.5 flex min-w-0 items-center justify-between gap-3">
              <SettingTitle className="mb-0 min-w-0">{t('code.model_selection')}</SettingTitle>
              {isClaudeTool && (
                <SegmentedControl<ClaudeModelMode>
                  size="sm"
                  value={claudeModelMode}
                  onValueChange={onClaudeModelModeChange}
                  options={[
                    { value: 'common', label: t('code.model_mode.common') },
                    { value: 'detailed', label: t('code.model_mode.detailed') }
                  ]}
                />
              )}
            </div>
            {modelSectionSlot}
          </SettingGroup>
          {toolFields && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <SettingTitle className="mb-2.5">{t('code.tool_parameters')}</SettingTitle>
              {toolFields}
            </SettingGroup>
          )}
          {hasAdvancedSection && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <AdvancedConfigToggle open={advancedOpen} onToggle={onAdvancedToggle}>
                <div className="space-y-5">
                  {advancedFields}
                  {files.length > 0 && <CliConfigEditor files={files} error={error} onChange={onFilesChange} />}
                </div>
              </AdvancedConfigToggle>
            </SettingGroup>
          )}
        </SettingContainer>

        <DialogFooter className="justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={onSubmit} disabled={!canSave} loading={submitting}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
