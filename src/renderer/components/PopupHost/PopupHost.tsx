import { popupService } from '@renderer/services/popup'
import { useSyncExternalStore } from 'react'

import ConfirmPopupItem from './ConfirmPopupItem'

/**
 * PopupHost — a leaf, not a wrapper. Mount it as a sibling of the window content,
 * inside every provider (popups read theme/i18n/data context) but never wrapping
 * children, one per window. It subscribes to the services/popup module store via
 * useSyncExternalStore and renders each entry: createPopup components get the
 * injected `{ open, resolve }`, confirm prefabs render through ConfirmPopupItem.
 *
 * It provides no context and accepts no children on purpose. The retired full-screen
 * view stack became a god component precisely because it wrapped the whole app — the
 * handiest place to hang global hooks. A leaf cannot regress that way.
 */
export default function PopupHost() {
  const entries = useSyncExternalStore(popupService.subscribe, popupService.getSnapshot, popupService.getSnapshot)

  return (
    <>
      {entries.map((entry) => {
        if (entry.kind === 'confirm') {
          return <ConfirmPopupItem key={entry.instanceId} entry={entry} />
        }

        const { Component, props, instanceId, open } = entry
        return (
          <Component
            key={instanceId}
            {...props}
            open={open}
            resolve={(result: unknown) => popupService.settle(instanceId, result)}
          />
        )
      })}
    </>
  )
}
