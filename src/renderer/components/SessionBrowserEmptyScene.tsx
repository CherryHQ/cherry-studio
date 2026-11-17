import { AppWindow, Globe, Plus } from 'lucide-react'

import { EmptyStateScene, SceneBar, SceneInput, ScenePanel, SceneSlot } from '@cherrystudio/ui'

/** No open tabs: the browser with an accent new-tab button and an empty address bar. */
export function SessionBrowserEmptyScene() {
  return (
    <EmptyStateScene
      size="panel"
      accent={1}
      sprites={[
        { x: 232, y: 3, color: 6, shape: 'corner', tilt: 10 },
        { x: 4, y: 84, color: 3, shape: 'cross', tilt: -12 },
        { x: 240, y: 120, color: 1, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <div className="flex h-[30px] shrink-0 items-center gap-[5px] border-b border-border-subtle px-[9px]">
          <SceneSlot accent className="size-[17px] justify-center rounded-[5px]">
            <Plus size={10} strokeWidth={2.4} />
          </SceneSlot>
          <SceneSlot className="h-[17px] w-[62px] px-[7px]">
            <SceneBar className="w-[34px]" />
          </SceneSlot>
        </div>
        <div className="border-b border-border-subtle px-[9px] py-[7px]">
          <SceneInput icon={Globe} value={<SceneBar className="w-[80px]" />} />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <AppWindow size={28} strokeWidth={1.3} className="text-foreground-disabled" />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
