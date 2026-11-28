import type { ComponentProps } from 'react'
import { Fragment, useMemo } from 'react'

import { useExitPresence } from '@renderer/hooks/useExitPresence'

import { ConfigEditPanel } from './configEditPanel/ConfigEditPanel'

interface CodeCliDialogsProps {
  configPanelKey?: string
  configPanelProps?: ComponentProps<typeof ConfigEditPanel>
}

export function CodeCliDialogs({ configPanelKey, configPanelProps }: CodeCliDialogsProps) {
  const configTarget = useMemo(
    () => (configPanelProps ? { key: configPanelKey, props: configPanelProps } : null),
    [configPanelKey, configPanelProps]
  )
  const configPanel = useExitPresence(configTarget)

  return configPanel.value ? (
    <Fragment key={configPanel.value.key}>
      <ConfigEditPanel {...configPanel.value.props} open={configPanelProps !== undefined} />
    </Fragment>
  ) : null
}
