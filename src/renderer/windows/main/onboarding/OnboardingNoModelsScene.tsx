import { Cloud } from 'lucide-react'

import { EmptyStateScene, SceneBar, SceneChip, SceneGhostRow, SceneHeader, ScenePanel } from '@cherrystudio/ui'

/** A cloud account with no models: its model list empty, the count marked at zero. */
export function OnboardingNoModelsScene() {
  return (
    <EmptyStateScene
      size="panel"
      accent={5}
      sprites={[
        { x: 232, y: 3, color: 2, shape: 'ring', tilt: 10 },
        { x: 4, y: 84, color: 4, shape: 'checker', tilt: -12 },
        { x: 240, y: 118, color: 5, shape: 'corner', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader
          icon={Cloud}
          title={<SceneBar className="w-[64px] bg-muted-foreground opacity-50" />}
          trailing={<SceneChip accent label="0" />}
        />
        <div className="flex flex-col gap-[6px] px-[10px] pt-[10px]">
          <SceneGhostRow lead />
          <SceneGhostRow lead />
          <SceneGhostRow lead />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
