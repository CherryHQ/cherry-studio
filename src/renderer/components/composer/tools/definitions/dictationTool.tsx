import { Copy, LoaderCircle, Mic, RotateCcw, Settings, Square, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type {
  ComposerToolLauncher,
  ComposerToolLauncherActionOptions
} from '@renderer/components/composer/toolLauncher'
import { DICTATION_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import { defineTool, type ToolRenderContext, TopicType } from '@renderer/components/composer/tools/types'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { dictationService, type DictationErrorCategory, type DictationPhase } from '@renderer/services/voice'

type DictationContext = ToolRenderContext<readonly [], readonly []>

const SETTINGS_RECOVERY_ERRORS = new Set<DictationErrorCategory>([
  'model_required',
  'unsupported',
  'asset_required',
  'license_unverified',
  'voice_unavailable',
  'microphone_permission'
])
const PHASE_TRANSLATION_KEYS: Record<Exclude<DictationPhase, 'idle'>, string> = {
  starting: 'settings.voice.dictation.phase.starting',
  recording: 'settings.voice.dictation.phase.recording',
  stopping: 'settings.voice.dictation.phase.stopping',
  transcribing: 'settings.voice.dictation.phase.transcribing',
  failed: 'settings.voice.dictation.phase.failed',
  recovery: 'settings.voice.dictation.phase.recovery'
}

function dictationErrorKey(error?: DictationErrorCategory) {
  switch (error) {
    case 'model_required':
      return 'settings.voice.status.unconfigured'
    case 'unsupported':
    case 'asset_required':
    case 'license_unverified':
    case 'voice_unavailable':
      return `settings.voice.status.${error}` as const
    case 'microphone_permission':
      return 'settings.voice.microphone.denied'
    default:
      return 'settings.voice.status.operation_failed'
  }
}

function restoreFocus(inputAdapter?: QuickPanelInputAdapter) {
  inputAdapter?.focus()
}

function runAction(action: () => unknown | Promise<unknown>, inputAdapter?: QuickPanelInputAdapter) {
  try {
    const result = action()
    if (result instanceof Promise) {
      void result.catch(() => undefined).finally(() => restoreFocus(inputAdapter))
    } else {
      restoreFocus(inputAdapter)
    }
  } catch {
    restoreFocus(inputAdapter)
  }
}

const DictationComposerRuntime = ({ context }: { context: DictationContext }) => {
  const { launcher, t } = context
  const snapshot = useSyncExternalStore(
    dictationService.subscribe,
    dictationService.getSnapshot,
    dictationService.getSnapshot
  )
  const { elapsedMs, error, phase, recoveryAvailable, retryAvailable } = snapshot

  const launchers = useMemo(() => {
    const status =
      phase === 'failed' ? t(dictationErrorKey(error)) : phase !== 'idle' ? t(PHASE_TRANSLATION_KEYS[phase]) : undefined
    const processing = phase === 'stopping' || phase === 'transcribing'
    const active = phase !== 'idle'
    const actionLabel =
      phase === 'recording'
        ? t('settings.voice.action.stop_recording')
        : phase === 'starting' || processing
          ? t('chat.input.dictation.action.cancel')
          : phase === 'recovery'
            ? t('settings.voice.action.insert_recovery')
            : retryAvailable
              ? t('settings.voice.action.retry')
              : t('chat.input.dictation.action.start')
    const icon =
      phase === 'recording' ? (
        <Square />
      ) : processing || phase === 'starting' ? (
        <LoaderCircle className="animate-spin" />
      ) : phase === 'failed' ? (
        <RotateCcw />
      ) : phase === 'recovery' ? (
        <Undo2 />
      ) : (
        <Mic />
      )
    const submenu: ComposerToolLauncher[] = []

    if (phase === 'recording') {
      submenu.push({
        id: 'dictation:stop',
        kind: 'command' as const,
        sources: ['root-panel'] as const,
        label: t('settings.voice.action.stop_recording'),
        icon: <Square />,
        action: ({ inputAdapter }: ComposerToolLauncherActionOptions) =>
          runAction(() => dictationService.stop(), inputAdapter)
      })
    }
    if (active && !recoveryAvailable) {
      submenu.push({
        id: 'dictation:cancel',
        kind: 'command' as const,
        sources: ['root-panel'] as const,
        label: t('chat.input.dictation.action.cancel'),
        icon: <X />,
        action: ({ inputAdapter }: ComposerToolLauncherActionOptions) =>
          runAction(() => dictationService.cancel(), inputAdapter)
      })
    }
    if (retryAvailable) {
      submenu.push({
        id: 'dictation:retry',
        kind: 'command' as const,
        sources: ['root-panel'] as const,
        label: t('settings.voice.action.retry'),
        icon: <RotateCcw />,
        action: ({ inputAdapter }: ComposerToolLauncherActionOptions) =>
          runAction(() => dictationService.retry(), inputAdapter)
      })
    }
    if (recoveryAvailable) {
      submenu.push(
        {
          id: 'dictation:insert-recovery',
          kind: 'command' as const,
          sources: ['root-panel'] as const,
          label: t('settings.voice.action.insert_recovery'),
          icon: <Undo2 />,
          action: ({ inputAdapter }: ComposerToolLauncherActionOptions) =>
            runAction(() => dictationService.insertRecovery(), inputAdapter)
        },
        {
          id: 'dictation:copy-recovery',
          kind: 'command' as const,
          sources: ['root-panel'] as const,
          label: t('chat.input.dictation.action.copy_recovery'),
          icon: <Copy />,
          action: ({ inputAdapter }: ComposerToolLauncherActionOptions) =>
            runAction(() => dictationService.copyRecovery(), inputAdapter)
        }
      )
    }
    if (phase === 'failed' || recoveryAvailable) {
      submenu.push({
        id: 'dictation:discard',
        kind: 'command' as const,
        sources: ['root-panel'] as const,
        label: t('settings.voice.action.discard'),
        icon: <Trash2 />,
        action: ({ inputAdapter }: ComposerToolLauncherActionOptions) =>
          runAction(() => dictationService.discard(), inputAdapter)
      })
    }
    if (error && SETTINGS_RECOVERY_ERRORS.has(error)) {
      submenu.push({
        id: 'dictation:open-settings',
        kind: 'command',
        sources: ['root-panel'],
        label: t('settings.voice.action.open_settings'),
        icon: <Settings />,
        action: () => openSettingsTab('/settings/voice')
      })
    }

    return [
      {
        ...DICTATION_TOOLBAR_MANIFEST.toolbar,
        sources: ['popover', 'root-panel'] as const,
        label: actionLabel,
        description: status,
        tooltip: actionLabel,
        searchAliases: getQuickPanelSearchAliases(t, 'chat.input.dictation.title'),
        icon,
        active,
        disabled: false,
        suffix:
          elapsedMs > 0 ? t('settings.voice.dictation.elapsed', { seconds: Math.floor(elapsedMs / 1000) }) : undefined,
        submenu,
        action: ({ inputAdapter }: ComposerToolLauncherActionOptions) => {
          if (phase === 'recording') {
            runAction(() => dictationService.stop(), inputAdapter)
          } else if (phase === 'starting' || processing) {
            runAction(() => dictationService.cancel(), inputAdapter)
          } else if (phase === 'recovery') {
            runAction(() => dictationService.insertRecovery(), inputAdapter)
          } else if (retryAvailable) {
            runAction(() => dictationService.retry(), inputAdapter)
          } else {
            const run = dictationService.startScoped()
            void run.result.catch(() => undefined)
            restoreFocus(inputAdapter)
          }
        }
      }
    ]
  }, [elapsedMs, error, phase, recoveryAvailable, retryAvailable, t])

  useEffect(() => launcher.registerLaunchers(launchers), [launcher, launchers])
  return null
}

const dictationTool = defineTool({
  key: 'dictation',
  label: DICTATION_TOOLBAR_MANIFEST.label,
  visibleInScopes: [TopicType.Chat, TopicType.Session, 'painting'],
  availableWithoutModel: true,
  composer: {
    runtime: ({ context }) => <DictationComposerRuntime context={context} />
  }
})

export default dictationTool
