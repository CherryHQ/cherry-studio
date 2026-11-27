import type { ComponentProps, FC } from 'react'
import { Fragment, useMemo } from 'react'

import { ConfirmDialog } from '@cherrystudio/ui'
import { useExitPresence } from '@renderer/hooks/useExitPresence'

import { CodeCliContentPanel } from './CodeCliContentPanel'
import { CodeCliSidebar } from './CodeCliSidebar'
import { ConfigEditPanel } from './configEditPanel/ConfigEditPanel'
import { OwnLoginConfigPanel } from './configEditPanel/OwnLoginConfigPanel'
import { LaunchDialog } from './LaunchDialog'

export interface CodeCliPageViewProps {
  sidebarProps: ComponentProps<typeof CodeCliSidebar>
  contentProps?: ComponentProps<typeof CodeCliContentPanel>
  emptyMessage: string
  launchDialogProps: ComponentProps<typeof LaunchDialog>
  removeDialogProps: ComponentProps<typeof ConfirmDialog>
  configPanelKey?: string
  configPanelProps?: ComponentProps<typeof ConfigEditPanel>
  ownLoginConfigPanelProps?: ComponentProps<typeof OwnLoginConfigPanel>
}

export const CodeCliPageView: FC<CodeCliPageViewProps> = ({
  sidebarProps,
  contentProps,
  emptyMessage,
  launchDialogProps,
  removeDialogProps,
  configPanelKey,
  configPanelProps,
  ownLoginConfigPanelProps
}) => {
  const configTarget = useMemo(
    () => (configPanelProps ? { key: configPanelKey, props: configPanelProps } : null),
    [configPanelKey, configPanelProps]
  )
  const ownLoginTarget = useMemo(
    () => (ownLoginConfigPanelProps ? { key: configPanelKey, props: ownLoginConfigPanelProps } : null),
    [configPanelKey, ownLoginConfigPanelProps]
  )
  const configPanel = useExitPresence(configTarget)
  const ownLoginPanel = useExitPresence(ownLoginTarget)

  return (
    <div data-ui="code.view" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-foreground">
      <div className="flex min-h-0 flex-1">
        <CodeCliSidebar {...sidebarProps} />

        <div data-ui="code.content" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {contentProps ? (
            <CodeCliContentPanel {...contentProps} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-foreground-tertiary">
              {emptyMessage}
            </div>
          )}
        </div>
      </div>

      <LaunchDialog {...launchDialogProps} />
      <ConfirmDialog {...removeDialogProps} />
      {configPanel.value && (
        <Fragment key={configPanel.value.key}>
          <ConfigEditPanel {...configPanel.value.props} open={configPanelProps !== undefined} />
        </Fragment>
      )}
      {ownLoginPanel.value && (
        <Fragment key={ownLoginPanel.value.key}>
          <OwnLoginConfigPanel {...ownLoginPanel.value.props} open={ownLoginConfigPanelProps !== undefined} />
        </Fragment>
      )}
    </div>
  )
}
