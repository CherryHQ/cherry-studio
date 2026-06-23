import Scrollbar from '@renderer/components/Scrollbar'
import type { FC, ReactNode } from 'react'

import { creationClasses } from './creationPrimitives'

interface CreationWorkspaceProps {
  modelSelector: ReactNode
  settings: ReactNode
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
              <div className={creationClasses.panel}>
                <div className={creationClasses.panelModelSelector}>{modelSelector}</div>
                <div className={creationClasses.panelBody}>
                  <Scrollbar className={creationClasses.panelScroll}>{settings}</Scrollbar>
                </div>
              </div>

              <div className={creationClasses.centerPane}>
                <div className={creationClasses.centerStage}>{artboard}</div>
                <div className={creationClasses.promptDock}>{promptBar}</div>
              </div>

              {historyStrip}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CreationWorkspace
