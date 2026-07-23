import { cn } from '@cherrystudio/ui/lib/utils'
import { type CSSProperties, type FC, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePaintingSizeInfo } from '../hooks/usePaintingSizeInfo'
import type { PaintingData } from '../model/types/paintingData'
import PaintingSkeletonGrid from './PaintingSkeletonGrid'

/**
 * Skeleton's max extent along its constrained axis. Matches the real image's
 * sizing: a bare `<img>` with `max-h-full max-w-full` never upscales past its
 * container, so the skeleton fills the same 100% box to avoid a size jump when
 * the real image replaces it.
 */
const SKELETON_MAX_SIZE = '100%'

/**
 * Placeholder shown in the artboard while an image generates: a
 * contribution-grid animation (`PaintingSkeletonGrid`) inside a box sized to
 * the selected aspect ratio — measuring the container, minus `topBar`'s own
 * measured height, to constrain whichever axis is the tighter fit, mirroring
 * how the real `<img>` sizes itself (`SKELETON_MAX_SIZE`) so the reveal
 * doesn't jump; fills the area when no ratio is known. Once the generated
 * image has been decoded (`naturalWidth`/`naturalHeight` known — see
 * `computeImageNaturalSize`), the box re-locks to `min(natural size, contain
 * fit)` in real pixels instead of the declared-ratio estimate, exactly
 * matching how the real `<img>` (`max-h-full max-w-full`, no upscale) will
 * render — the ResizeObserver in `PaintingSkeletonGrid` picks up the new box
 * size and remounts the grid via `gridKey`, so Act 2's colour wave starts on
 * the final geometry instead of resizing mid-sweep. Falls back to the
 * declared-ratio box until the natural size is known. The composer's stop
 * button owns cancellation, so this carries no text or controls.
 */
const PaintingImageSkeleton: FC<{
  imageUrl?: string
  naturalWidth?: number
  naturalHeight?: number
  onRevealReady?: () => void
  painting: PaintingData
  /** Rendered directly above the skeleton box, stretched to match its width. */
  topBar?: ReactNode
}> = ({ imageUrl, naturalWidth, naturalHeight, onRevealReady, painting, topBar }) => {
  const { t } = useTranslation()
  const { ratio } = usePaintingSizeInfo(painting)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<{ width: number; height: number } | null>(null)
  const topBarObserverRef = useRef<ResizeObserver | null>(null)
  const [topBarHeight, setTopBarHeight] = useState(0)

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = () => setContainer({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // `topBar` renders inside the same column as the box (see below), so its own
  // height has to come out of the space the box's contain-fit math treats as
  // available — otherwise bar + box together can exceed the measured container
  // and the bottom of the box gets clipped instead of ratio-matching the real
  // `<img>`. A callback ref (not a mount-only effect) re-attaches whenever
  // `topBar` toggles between present and absent, mirroring the pattern
  // Artboard uses for the same reason on its own prompt bar.
  const setTopBarRef = useCallback((el: HTMLDivElement | null) => {
    topBarObserverRef.current?.disconnect()
    topBarObserverRef.current = null
    if (!el) {
      setTopBarHeight(0)
      return
    }
    const measure = () => setTopBarHeight(el.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    topBarObserverRef.current = observer
  }, [])

  const availableHeight = container ? Math.max(0, container.height - topBarHeight) : null
  const hasMeasuredWidth = container != null && container.width > 0
  const hasAvailableHeight = availableHeight != null && availableHeight > 0

  const containerRatio =
    hasMeasuredWidth && hasAvailableHeight && container && availableHeight ? container.width / availableHeight : null

  // Reveal geometry relock: once the real image's natural size is known, lock
  // the box to it — capped by the container's contain-fit size (minus the top
  // bar) — so it renders at exactly the pixel size the real `<img>` will use
  // next (never upscaled past its own resolution). Falls back to the
  // declared-ratio box below when dimensions aren't known yet (`container`
  // unmeasured, or the reveal hasn't decoded the natural size).
  let lockedSize: { width: number; height: number } | null = null
  if (naturalWidth && naturalHeight && naturalWidth > 0 && naturalHeight > 0 && container && availableHeight != null) {
    const scale = Math.min(1, container.width / naturalWidth, availableHeight / naturalHeight)
    lockedSize = { width: naturalWidth * scale, height: naturalHeight * scale }
  }

  // Match the real image's `max-h-full max-w-full` + `object-contain` — resolve
  // the box to explicit pixels wherever its size is known (locked to the decoded
  // natural size, or derived from the declared ratio once measured), constraining
  // whichever axis is the tighter fit: height when the image is narrower than the
  // container (portrait), width otherwise.
  let boxSize: { width: number; height: number } | null = lockedSize
  if (!boxSize && ratio != null && container) {
    if (containerRatio != null && ratio < containerRatio && availableHeight != null) {
      boxSize = { width: availableHeight * ratio, height: availableHeight }
    } else if (hasMeasuredWidth) {
      boxSize = { width: container.width, height: container.width / ratio }
    }
  }

  // Explicit px once sized; `SKELETON_MAX_SIZE` before the first measurement
  // (avoids a collapsed box); `undefined` when no ratio is known at all.
  const boxStyle: CSSProperties | undefined = boxSize
    ? { width: boxSize.width, height: boxSize.height }
    : ratio == null
      ? undefined
      : { width: SKELETON_MAX_SIZE, height: 'auto', aspectRatio: String(ratio) }

  const hasKnownSize = boxStyle != null
  // Pin the [topBar, box] column to the box's pixel width so the top bar tracks
  // the image edges, instead of a long prompt's intrinsic width stretching the
  // column out to the full canvas (with only the box carrying the width, the
  // column is free to grow past a narrow/portrait image). Undefined in the
  // pre-measurement fallback, where the column fills the available width.
  const columnWidth = boxSize?.width

  return (
    <div
      ref={wrapperRef}
      className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label={t(imageUrl ? 'paintings.revealing' : 'paintings.generating')}>
      <div
        className={cn('flex flex-col items-stretch', hasKnownSize ? 'max-h-full max-w-full' : 'h-full w-full')}
        style={columnWidth != null ? { width: columnWidth } : undefined}>
        {topBar && (
          <div ref={setTopBarRef} className="min-w-0" data-testid="painting-skeleton-top-bar-measure">
            {topBar}
          </div>
        )}
        <div className={cn('overflow-hidden rounded-md bg-muted', !hasKnownSize && 'min-h-0 flex-1')} style={boxStyle}>
          <PaintingSkeletonGrid imageUrl={imageUrl} onRevealReady={onRevealReady} />
        </div>
      </div>
    </div>
  )
}

export default PaintingImageSkeleton
