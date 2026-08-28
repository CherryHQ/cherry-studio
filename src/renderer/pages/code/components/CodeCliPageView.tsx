import { ConfirmDialog } from '@cherrystudio/ui'
import type { ComponentProps, FC } from 'react'
import { Fragment } from 'react'

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
  return (
    <div data-ui="code.view" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-foreground">
      <div className="flex min-h-0 flex-1">
        <CodeCliSidebar {...sidebarProps} />

        <div data-ui="code.content" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {contentProps ? (
            <CodeCliContentPanel {...contentProps} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-foreground-tertiary text-sm">
              {emptyMessage}
            </div>
          )}
        </div>
      </div>

      <LaunchDialog {...launchDialogProps} />
      <ConfirmDialog {...removeDialogProps} />
      {configPanelProps && (
        <Fragment key={configPanelKey}>
          <ConfigEditPanel {...configPanelProps} />
        </Fragment>
      )}
      {ownLoginConfigPanelProps && (
        <Fragment key={configPanelKey}>
          <OwnLoginConfigPanel {...ownLoginConfigPanelProps} />
        </Fragment>
      )}
    </div>
  )
}
