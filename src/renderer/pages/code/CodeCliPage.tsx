import { useTranslation } from 'react-i18next'

import { CommandContextMenu } from '@renderer/components/command'
import SidebarShortcutIcon from '@renderer/components/icons/SidebarShortcutIcon'
import { LocalAgentDirectory } from '@renderer/components/localAgent/LocalAgentDirectory'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'

import { CodeCliConfiguration } from './components/CodeCliConfiguration'
import { LocalAgentCliConfig } from './components/LocalAgentCliConfig'

export default function CodeCliPage({
  destination = '/app/code'
}: {
  destination?: '/app/code' | '/settings/local-agents'
}) {
  const { t } = useTranslation()
  const { isPinned, setPinned } = useSidebarShortcuts()
  return (
    <LocalAgentDirectory
      destination={destination}
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
      renderCli={(tool) => <CodeCliConfiguration key={tool} initialTool={tool} embedded />}
    />
  )
}
