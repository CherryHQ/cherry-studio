import { useTranslation } from 'react-i18next'

import { CommandContextMenu } from '@renderer/components/command'
import SidebarShortcutIcon from '@renderer/components/icons/SidebarShortcutIcon'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'

import { CodeCliConfiguration } from './components/CodeCliConfiguration'
import { DeepSeekHarnessAgentDetails } from './components/DeepSeekHarnessAgentDetails'
import { LocalAgentCliConfig } from './components/LocalAgentCliConfig'
import { LocalAgentDetails, LocalAgentDirectory } from './components/LocalAgentDirectory'

export default function CodeCliPage() {
  const { t } = useTranslation()
  const { isPinned, setPinned } = useSidebarShortcuts()
  return (
    <LocalAgentDirectory
      renderContextMenu={(id, tool, name, row) => {
        const target = createSidebarShortcutTarget(
          tool ? SIDEBAR_SHORTCUT_PROVIDER_IDS.CODE_CLI : SIDEBAR_SHORTCUT_PROVIDER_IDS.LOCAL_AGENT,
          tool ?? id
        )
        const pinned = isPinned(target)
        return (
          <CommandContextMenu
            key={id}
            location="webcontents.context"
            extraItems={[
              {
                type: 'item',
                id: `code-cli.toggle-sidebar.${id}`,
                label: t(pinned ? 'miniApp.remove_from_sidebar' : 'miniApp.add_to_sidebar'),
                icon: <SidebarShortcutIcon size={14} pinned={pinned} />,
                onSelect: () => setPinned(target, !pinned, name)
              }
            ]}>
            {row}
          </CommandContextMenu>
        )
      }}
      renderCliConfig={(tool) => <LocalAgentCliConfig key={tool} tool={tool} />}
      renderDetails={(props) =>
        props.preset?.id === 'deepseek-harness' ? (
          <DeepSeekHarnessAgentDetails key={props.preset.id} {...props} />
        ) : (
          <LocalAgentDetails key={props.preset?.id ?? props.agent?.id ?? 'custom-new'} {...props} />
        )
      }
      renderCli={(tool) => <CodeCliConfiguration key={tool} initialTool={tool} />}
    />
  )
}
