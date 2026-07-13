import { Button } from '@cherrystudio/ui'
import { useNodes, useReactFlow, useStore, useViewport } from '@xyflow/react'
import { LocateFixed } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { PAINTING_NODE_WIDTH } from './PaintingNode'

/**
 * Centered "back to content" affordance — shown only when cards exist but none
 * intersect the current viewport (the user panned/zoomed away). Clicking refits
 * the view to the cards; `onMoveEnd` then persists the recentered viewport.
 */
const BackToContent: FC = () => {
  const { t } = useTranslation()
  const { fitView } = useReactFlow()
  const { x, y, zoom } = useViewport()
  const nodes = useNodes()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)

  if (nodes.length === 0 || width === 0 || height === 0) return null

  // Visible area expressed in flow coordinates.
  const left = -x / zoom
  const top = -y / zoom
  const right = left + width / zoom
  const bottom = top + height / zoom

  const anyVisible = nodes.some((node) => {
    const w = node.measured?.width ?? (typeof node.width === 'number' ? node.width : PAINTING_NODE_WIDTH)
    const h = node.measured?.height ?? (typeof node.height === 'number' ? node.height : PAINTING_NODE_WIDTH)
    return (
      node.position.x < right && node.position.x + w > left && node.position.y < bottom && node.position.y + h > top
    )
  })

  if (anyVisible) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-events-auto gap-1.5 rounded-full bg-background/90 shadow-md backdrop-blur"
        onClick={() => fitView({ duration: 400, padding: 0.2 })}>
        <LocateFixed className="size-4" />
        {t('paintings.canvas.back_to_content')}
      </Button>
    </div>
  )
}

export default BackToContent
