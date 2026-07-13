import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import { Settings2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ComposerToolbarPinnedToolsKey = 'chat.input.toolbar.pinned_tools' | 'agent.input.toolbar.pinned_tools'

/**
 * Single entry point for a composer variant's pinned toolbar tools preference:
 * the ordered launcher/custom-tool ids rendered as persistent shortcut buttons.
 * Also owns the customize-popover open state, opened via the "+" panel's
 * trailing item.
 */
export function useComposerToolbarPinnedTools(prefKey: ComposerToolbarPinnedToolsKey) {
  const { t } = useTranslation()
  const [pinnedIds, persistPinnedIds] = usePreference(prefKey)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  const setPinnedIds = useCallback(
    (next: string[]) => {
      void persistPinnedIds(next).catch(() => {
        toast.error(t('common.error'))
      })
    },
    [persistPinnedIds, t]
  )

  const customizePanelItem = useMemo<QuickPanelListItem>(() => {
    const label = t('chat.input.toolbar.customize')
    return {
      id: 'composer:customize-toolbar',
      label,
      icon: <Settings2 size={16} />,
      filterText: label,
      action: () => setCustomizeOpen(true)
    }
  }, [t])

  return { pinnedIds, setPinnedIds, customizeOpen, setCustomizeOpen, customizePanelItem }
}
