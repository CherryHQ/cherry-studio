import type { ComponentProps, FC } from 'react'
import { Fragment, useMemo } from 'react'

import { ConfirmDialog } from '@cherrystudio/ui'
import { AgentTerminalDialog } from '@renderer/components/localAgent/AgentTerminalDialog'
import { useExitPresence } from '@renderer/hooks/useExitPresence'

import { CodeCliContentPanel } from './CodeCliContentPanel'
import { ConfigEditPanel } from './configEditPanel/ConfigEditPanel'
import { OwnLoginConfigPanel } from './configEditPanel/OwnLoginConfigPanel'

export interface CodeCliPageViewProps {
  contentProps?: ComponentProps<typeof CodeCliContentPanel>
  emptyMessage: string
  launchDialogProps: ComponentProps<typeof AgentTerminalDialog>
  removeDialogProps: ComponentProps<typeof ConfirmDialog>
  configPanelKey?: string
  configPanelProps?: ComponentProps<typeof ConfigEditPanel>
  ownLoginConfigPanelProps?: ComponentProps<typeof OwnLoginConfigPanel>
}

export const CodeCliPageView: FC<CodeCliPageViewProps> = ({
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

      <CodeCliDialogs
        launchDialogProps={launchDialogProps}
        removeDialogProps={removeDialogProps}
        configPanelKey={configPanelKey}
        configPanelProps={configPanelProps}
        ownLoginConfigPanelProps={ownLoginConfigPanelProps}
      />
    </div>
  )
}

export function CodeCliDialogs({
  launchDialogProps,
  removeDialogProps,
  configPanelKey,
  configPanelProps,
  ownLoginConfigPanelProps
}: Omit<CodeCliPageViewProps, 'contentProps' | 'emptyMessage'>) {
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
    <>
      <AgentTerminalDialog {...launchDialogProps} />
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
    </>
  )
}
