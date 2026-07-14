import type { FC, ReactNode } from 'react'

import { creationClasses } from './creationPrimitives'

interface CreationWorkspaceProps {
  artboard: ReactNode
  promptBar: ReactNode
  historyStrip: ReactNode
}

/**
 * The Creation page's shared shell: gallery strip (left) | center pane
 * (artboard over the composer dock). Both modes are composer-centric — the
 * model selector, params, mode pills and media slots all live inside the
 * prompt bar, so there is no side panel.
 */
const CreationWorkspace: FC<CreationWorkspaceProps> = ({ artboard, promptBar, historyStrip }) => {
  return (
    <div className={creationClasses.page}>
      <div id="content-container" className={creationClasses.content}>
        <div className="flex h-full flex-1 flex-col">
          <div className={creationClasses.frame}>
            <div className={creationClasses.surface}>
              {historyStrip}

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
