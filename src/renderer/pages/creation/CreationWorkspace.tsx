import Scrollbar from '@renderer/components/Scrollbar'
import type { FC, ReactNode } from 'react'

import { creationClasses } from './creationPrimitives'

interface CreationWorkspaceProps {
  /**
   * Left settings panel (model selector on top, scrollable settings below).
   * The image flow omits both — its model selector + params live in the
   * composer's bottom toolbar; the video flow still renders the panel.
   */
  modelSelector?: ReactNode
  settings?: ReactNode
  artboard: ReactNode
  promptBar: ReactNode
  historyStrip: ReactNode
}

const CreationWorkspace: FC<CreationWorkspaceProps> = ({
  modelSelector,
  settings,
  artboard,
  promptBar,
  historyStrip
}) => {
  return (
    <div className={creationClasses.page}>
      <div id="content-container" className={creationClasses.content}>
        <div className="flex h-full flex-1 flex-col">
          <div className={creationClasses.frame}>
            <div className={creationClasses.surface}>
              {historyStrip}

              {(modelSelector || settings) && (
                <div className={creationClasses.panel}>
                  {modelSelector && <div className={creationClasses.panelModelSelector}>{modelSelector}</div>}
                  {settings && (
                    <div className={creationClasses.panelBody}>
                      <Scrollbar className={creationClasses.panelScroll}>{settings}</Scrollbar>
                    </div>
                  )}
                </div>
              )}

              <div className={creationClasses.centerPane}>
                <div className={creationClasses.centerStage}>{artboard}</div>
                <div className={creationClasses.promptDock}>{promptBar}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CreationWorkspace
