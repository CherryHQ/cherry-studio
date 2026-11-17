import { Image, Sparkles } from 'lucide-react'

import { EmptyStateScene, SceneSlot } from '@cherrystudio/ui'

/** No image yet: the empty canvas slot where the generated image will land. */
export function PaintingEmptyScene() {
  return (
    <EmptyStateScene
      size="panel"
      accent={6}
      sprites={[
        { x: 214, y: 12, color: 4, shape: 'checker', tilt: 10 },
        { x: 28, y: 92, color: 7, shape: 'corner', tilt: -12 },
        { x: 220, y: 126, color: 6, shape: 'ring', tilt: 8 }
      ]}>
      <SceneSlot
        accent
        className="absolute top-[18px] left-[66px] h-[140px] w-[128px] flex-col justify-center gap-[8px] rounded-[14px]">
        <span className="relative">
          <Image size={26} strokeWidth={1.4} />
          <Sparkles size={11} strokeWidth={2} className="absolute -top-[5px] -right-[8px]" />
        </span>
        <span className="text-[7px] font-medium opacity-70">1024 × 1024</span>
      </SceneSlot>
    </EmptyStateScene>
  )
}
