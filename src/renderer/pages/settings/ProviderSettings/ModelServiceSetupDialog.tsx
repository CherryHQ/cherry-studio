import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, SearchInput } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import type {
  ModelServiceSetupContext,
  ModelServiceSetupFilter,
  ModelServiceSetupResult
} from '@renderer/services/ModelServiceSetupService'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import { isCodexProviderId } from '@shared/data/presets/codex'
import { isGrokCliProviderId } from '@shared/data/presets/grokCli'
import type { Provider } from '@shared/data/types/provider'
import { isLoginBasedProvider, matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import { ChevronRight, ExternalLink, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProviderAvatar } from './components/ProviderAvatar'
import ProviderApiSetupDialog, { type ProviderApiSetupInitialStep } from './ConnectionSettings/ProviderApiSetupDialog'
import { useOvmsSupport } from './hooks/useOvmsSupport'
import { providerListClasses } from './primitives/ProviderSettingsPrimitives'
import {
  type ProviderCreationContext,
  ProviderEditorDrawer,
  type SubmitProviderEditorParams,
  useProviderEditor
} from './ProviderList'
import ProviderLoginSetupDialog, { type ProviderLoginSetupKind } from './ProviderLoginSetupDialog'
import {
  getFancyProviderName,
  isProviderPresetInstanceSource,
  isProviderSettingsListVisibleProvider,
  matchKeywordsInProvider
} from './utils/providerDisplay'

interface ModelServiceSetupDialogProps {
  open: boolean
  setupContext: ModelServiceSetupContext
  initialProviderId?: string
  modelFilter?: ModelServiceSetupFilter
  onCloseAutoFocus?: () => void
  onResolve: (result: ModelServiceSetupResult) => void
}

type SetupView =
  | { type: 'providers' }
  | { type: 'api'; providerId: string; initialStep: ProviderApiSetupInitialStep }
  | { type: 'login'; provider: Provider; loginKind: ProviderLoginSetupKind }
  | { type: 'hidden' }

function canUseGuidedApiKeySetup(provider: Provider): boolean {
  return (
    provider.authType === 'api-key' &&
    provider.authOptional !== true &&
    !isLoginBasedProvider(provider) &&
    !matchesPreset(provider, 'copilot')
  )
}

function getGuidedLoginKind(provider: Provider, setupContext: ModelServiceSetupContext): ProviderLoginSetupKind | null {
  if (isCodexProviderId(provider.id) || isGrokCliProviderId(provider.id)) return 'managed-oauth'
  if (isClaudeCodeProviderId(provider.id)) return setupContext === 'agent' ? 'external-cli' : null
  if (provider.id === SystemProviderIds.cherryin && provider.apiKeys.length === 0) return 'cherryin'
  return null
}

export default function ModelServiceSetupDialog({
  open,
  setupContext,
  initialProviderId,
  modelFilter,
  onCloseAutoFocus,
  onResolve
}: ModelServiceSetupDialogProps) {
  const { t } = useTranslation()
  const { providers, isLoading: isLoadingProviders } = useProviders()
  const { models: enabledModels, isLoading: isLoadingModels } = useModels({ enabled: true })
  const { isSupported: isOvmsSupported } = useOvmsSupport()
  const [searchText, setSearchText] = useState('')
  const [view, setView] = useState<SetupView>(() => (initialProviderId ? { type: 'hidden' } : { type: 'providers' }))
  const [useDefaultProviderMotion, setUseDefaultProviderMotion] = useState(true)
  const setupResultRef = useRef<ModelServiceSetupResult>(null)
  const closeIntentRef = useRef<'dismiss' | 'transition'>('dismiss')
  const initialProviderHandledRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleProviderCreated = useCallback((providerId: string, context: ProviderCreationContext) => {
    setupResultRef.current = null
    setView({
      type: 'api',
      providerId,
      initialStep: context.hasApiKey ? 'models' : 'api-key'
    })
  }, [])

  const {
    isOpen: editorOpen,
    mode: editorMode,
    initialLogo,
    startAdd,
    startAddFrom,
    cancel: cancelEditor,
    submit: submitEditor
  } = useProviderEditor({ onProviderCreated: handleProviderCreated })

  const enabledModelProviderIds = useMemo(
    () => new Set(enabledModels.map((model) => model.providerId)),
    [enabledModels]
  )
  const visibleProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          isProviderSettingsListVisibleProvider(provider) &&
          (provider.id !== 'ovms' || isOvmsSupported === true) &&
          (setupContext === 'agent' || !isClaudeCodeProviderId(provider.id))
      ),
    [isOvmsSupported, providers, setupContext]
  )
  const filteredProviders = useMemo(() => {
    const keywords = searchText.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return visibleProviders.filter((provider) => matchKeywordsInProvider(keywords, provider))
  }, [searchText, visibleProviders])
  const presetSources = useMemo(() => visibleProviders.filter(isProviderPresetInstanceSource), [visibleProviders])
  const isLoading = isLoadingProviders || isLoadingModels

  const transitionFromProviderList = useCallback((nextView: SetupView, action?: () => void) => {
    closeIntentRef.current = 'transition'
    setUseDefaultProviderMotion(false)
    setView(nextView)
    action?.()
  }, [])

  const openProviderSettings = useCallback(
    (providerId: string) => {
      transitionFromProviderList({ type: 'hidden' }, () => {
        onResolve(null)
        openSettingsTab(`/settings/provider?id=${encodeURIComponent(providerId)}`)
      })
    },
    [onResolve, transitionFromProviderList]
  )

  const openModelServiceSettings = useCallback(() => {
    transitionFromProviderList({ type: 'hidden' }, () => {
      onResolve(null)
      openSettingsTab('/settings/provider')
    })
  }, [onResolve, transitionFromProviderList])

  const selectProvider = useCallback(
    (provider: Provider, openConfiguredProviderSettings = true) => {
      const hasActiveModels = provider.isEnabled && enabledModelProviderIds.has(provider.id)
      if (hasActiveModels && openConfiguredProviderSettings) {
        openProviderSettings(provider.id)
        return
      }

      const loginKind = getGuidedLoginKind(provider, setupContext)
      if (loginKind) {
        setupResultRef.current = null
        transitionFromProviderList({ type: 'login', provider, loginKind })
        return
      }

      if (!canUseGuidedApiKeySetup(provider)) {
        openProviderSettings(provider.id)
        return
      }

      setupResultRef.current = null
      transitionFromProviderList({
        type: 'api',
        providerId: provider.id,
        initialStep: provider.apiKeys.length > 0 ? 'models' : 'api-key'
      })
    },
    [enabledModelProviderIds, openProviderSettings, setupContext, transitionFromProviderList]
  )

  useEffect(() => {
    if (!initialProviderId || initialProviderHandledRef.current || isLoading) return

    initialProviderHandledRef.current = true
    const initialProvider = visibleProviders.find((provider) => provider.id === initialProviderId)
    if (initialProvider) {
      selectProvider(initialProvider, false)
    } else {
      setView({ type: 'providers' })
    }
  }, [initialProviderId, isLoading, selectProvider, visibleProviders])

  const openCustomProviderEditor = useCallback(() => {
    transitionFromProviderList({ type: 'hidden' }, startAdd)
  }, [startAdd, transitionFromProviderList])

  const closeCustomProviderEditor = useCallback(() => {
    cancelEditor()
    closeIntentRef.current = 'dismiss'
    setUseDefaultProviderMotion(false)
    setView({ type: 'providers' })
  }, [cancelEditor])

  const handleSubmitEditor = useCallback(
    async (providerInput: SubmitProviderEditorParams) => {
      await submitEditor(providerInput)
    },
    [submitEditor]
  )

  const returnToProviderList = useCallback(() => {
    setupResultRef.current = null
    closeIntentRef.current = 'dismiss'
    setUseDefaultProviderMotion(false)
    setView({ type: 'providers' })
  }, [])

  const continueLoginSetupForProvider = useCallback((providerId: string, step: ProviderApiSetupInitialStep) => {
    setView({ type: 'api', providerId, initialStep: step })
  }, [])

  const handleApiSetupClosed = useCallback(() => {
    const result = setupResultRef.current
    setupResultRef.current = null
    setView({ type: 'hidden' })
    onResolve(result)
  }, [onResolve])

  const handleLoginSetupClosed = useCallback(() => {
    const result = setupResultRef.current
    setupResultRef.current = null
    setView({ type: 'hidden' })
    onResolve(result)
  }, [onResolve])

  return (
    <>
      <Dialog
        open={open && view.type === 'providers' && !editorOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && closeIntentRef.current === 'dismiss') {
            setUseDefaultProviderMotion(true)
            onResolve(null)
          }
        }}>
        <DialogContent
          aria-describedby={undefined}
          size="lg"
          motion={useDefaultProviderMotion ? 'directional' : 'none'}
          className="grid h-[min(620px,calc(100vh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-4 [&_[data-slot=dialog-close]]:top-7"
          data-testid="model-service-setup-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchInputRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (closeIntentRef.current === 'transition') {
              event.preventDefault()
              closeIntentRef.current = 'dismiss'
              return
            }
            if (onCloseAutoFocus) {
              event.preventDefault()
              onCloseAutoFocus()
            }
          }}>
          <DialogHeader>
            <DialogTitle>{t('settings.provider.model_service_setup.title')}</DialogTitle>
          </DialogHeader>

          <SearchInput
            ref={searchInputRef}
            value={searchText}
            disabled={isLoading}
            placeholder={t('settings.provider.search')}
            aria-label={t('settings.provider.search')}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchText) {
                event.stopPropagation()
                setSearchText('')
              }
            }}
            onClear={() => setSearchText('')}
            clearLabel={t('common.clear')}
          />

          <Scrollbar className="min-h-0 pr-1">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                {t('common.loading')}
              </div>
            ) : filteredProviders.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                {t('common.no_results')}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredProviders.map((provider) => {
                  const opensSettings =
                    (provider.isEnabled && enabledModelProviderIds.has(provider.id)) ||
                    (!getGuidedLoginKind(provider, setupContext) && !canUseGuidedApiKeySetup(provider))
                  const name = getFancyProviderName(provider)

                  return (
                    <Button
                      key={provider.id}
                      type="button"
                      variant="ghost"
                      size="lg"
                      className="h-12 w-full justify-start gap-3 px-3"
                      onClick={() => selectProvider(provider)}>
                      <ProviderAvatar
                        provider={{ ...provider, name }}
                        size={26}
                        className={providerListClasses.itemAvatar}
                        displayContext="provider-list"
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
                      {opensSettings ? (
                        <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                          {t('settings.provider.model_service_setup.open_settings')}
                          <ExternalLink className="size-3" />
                        </span>
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                    </Button>
                  )
                })}
              </div>
            )}
          </Scrollbar>

          <div className="grid grid-cols-2 gap-2 border-border-subtle border-t pt-3">
            <Button type="button" variant="outline" size="lg" className="w-full" onClick={openCustomProviderEditor}>
              <Plus className="size-4" />
              {t('settings.provider.create_custom.title')}
            </Button>
            <Button type="button" variant="outline" size="lg" className="w-full" onClick={openModelServiceSettings}>
              {t('settings.provider.model_service_setup.manage_in_settings')}
              <ExternalLink className="size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ProviderEditorDrawer
        open={open && editorOpen}
        mode={editorMode}
        initialLogo={initialLogo}
        presetSources={presetSources}
        seamlessTransitions
        onClose={closeCustomProviderEditor}
        onSelectPreset={startAddFrom}
        onSubmit={handleSubmitEditor}
      />

      {view.type === 'login' ? (
        <ProviderLoginSetupDialog
          provider={view.provider}
          kind={view.loginKind}
          modelFilter={modelFilter}
          seamlessTransitions
          onBack={returnToProviderList}
          onClose={handleLoginSetupClosed}
          onCloseAutoFocus={onCloseAutoFocus}
          onContinueToApiSetup={(step) => continueLoginSetupForProvider(view.provider.id, step)}
          onSetupSuccess={(models) => {
            setupResultRef.current = models
          }}
        />
      ) : null}

      {view.type === 'api' ? (
        <ProviderApiSetupDialog
          providerId={view.providerId}
          initialStep={view.initialStep}
          modelFilter={modelFilter}
          seamlessTransitions
          onBack={returnToProviderList}
          onClose={handleApiSetupClosed}
          onCloseAutoFocus={onCloseAutoFocus}
          onSetupSuccess={(models) => {
            setupResultRef.current = models
          }}
        />
      ) : null}
    </>
  )
}
