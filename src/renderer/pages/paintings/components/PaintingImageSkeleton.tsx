import { cn } from '@cherrystudio/ui/lib/utils'
import {
  type CSSProperties,
  type FC,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem } from '../form/baseConfigItem'
import { deriveChipLabel, parseRatio } from '../form/fields/SizeChipsField'
import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import type { PaintingData } from '../model/types/paintingData'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
import PaintingSkeletonGrid from './PaintingSkeletonGrid'

/** Size-bearing canonical keys, mirroring the composer's summary (`SIZE_PREVIEW_KEYS`). */
const SIZE_KEYS: readonly string[] = ['size', 'imageResolution', 'aspectRatio']

/**
 * Skeleton's max extent along its constrained axis. Matches the real image's
 * sizing: a bare `<img>` with `max-h-full max-w-full` never upscales past its
 * container, so the skeleton fills the same 100% box to avoid a size jump when
 * the real image replaces it.
 */
const SKELETON_MAX_SIZE = '100%'

/**
 * Aspect ratio of the image about to be generated, taken from the same
 * effective value the composer surfaces: `params[key] ?? item.initialValue` over
 * the model's size-bearing field. Reading `initialValue` (the registry default)
 * is what makes it correct before the user changes anything — the value shown as
 * `1024×1024` lives in the field default, not `params`. Custom sizes read the
 * explicit width × height. An `auto` size (the model picks the dimensions) falls
 * back to a 1:1 square. Returns null only with no size signal at all
 * (resolution-only tiers like `"1K"`, or a model without a size field), in which
 * case the skeleton fills the area.
 */
export function resolveRatio(params: PaintingData['params'], items: BaseConfigItem[]): number | null {
  let sawAuto = false
  for (const item of items) {
    if (!item.key || !SIZE_KEYS.includes(item.key)) continue
    if (item.condition && !item.condition(params ?? {})) continue

    const value = params?.[item.key] ?? item.initialValue
    if (value === 'custom') {
      const customWidth = Number(params?.customSize_width)
      const customHeight = Number(params?.customSize_height)
      if (customWidth > 0 && customHeight > 0) return customWidth / customHeight
      continue
    }

    if (typeof value !== 'string') continue
    // `auto` lets the model choose — remember it but keep scanning in case
    // another field carries a concrete ratio to prefer.
    if (value === 'auto') {
      sawAuto = true
      continue
    }
    const dim = parseRatio(value)
    if (dim && dim.w > 0 && dim.h > 0) return dim.w / dim.h
  }

  // No concrete ratio: use a 1:1 square for `auto`, otherwise fill the area.
  return sawAuto ? 1 : null
}

/**
 * Human-readable size label for the same effective value `resolveRatio` reads
 * (`params[key] ?? item.initialValue` over the size-bearing field) — e.g.
 * `1024×1024` or `auto`. Used by the artboard's prompt bar; distinct from
 * `resolveRatio` in that it keeps `auto` as a label instead of collapsing it
 * to a 1:1 ratio. Returns undefined when the model declares no size field or
 * a custom size has no explicit dimensions yet.
 */
export function resolveSizeLabel(params: PaintingData['params'], items: BaseConfigItem[]): string | undefined {
  for (const item of items) {
    if (!item.key || !SIZE_KEYS.includes(item.key)) continue
    if (item.condition && !item.condition(params ?? {})) continue

    const value = params?.[item.key] ?? item.initialValue
    if (value === 'custom') {
      const customWidth = Number(params?.customSize_width)
      const customHeight = Number(params?.customSize_height)
      return customWidth > 0 && customHeight > 0 ? `${customWidth}×${customHeight}` : undefined
    }

    if (typeof value !== 'string' || value === '') continue
    return deriveChipLabel(value, value)
  }

  return undefined
}

/**
 * Placeholder shown in the artboard while an image generates: a
 * contribution-grid animation (`PaintingSkeletonGrid`) inside a box sized to
 * the selected aspect ratio — measuring the container, minus `topBar`'s own
 * measured height, to constrain whichever axis is the tighter fit, mirroring
 * how the real `<img>` sizes itself (`SKELETON_MAX_SIZE`) so the reveal
 * doesn't jump; fills the area when no ratio is known. Once the generated
 * image has been decoded (`naturalWidth`/`naturalHeight` known — see
 * `computeImageBlurhash`), the box re-locks to `min(natural size, contain
 * fit)` in real pixels instead of the declared-ratio estimate, exactly
 * matching how the real `<img>` (`max-h-full max-w-full`, no upscale) will
 * render — the ResizeObserver in `PaintingSkeletonGrid` picks up the new box
 * size and remounts the grid via `gridKey`, so Act 2's colour wave starts on
 * the final geometry instead of resizing mid-sweep. Falls back to the
 * declared-ratio box when dimensions aren't available (decode failed, or not
 * measured yet). The composer's stop button owns cancellation, so this
 * carries no text or controls.
 */
const PaintingImageSkeleton: FC<{
  blurhash?: string
  imageUrl?: string
  naturalWidth?: number
  naturalHeight?: number
  onRevealReady?: () => void
  painting: PaintingData
  /** Rendered directly above the skeleton box, stretched to match its width. */
  topBar?: ReactNode
}> = ({ blurhash, imageUrl, naturalWidth, naturalHeight, onRevealReady, painting, topBar }) => {
  const { t } = useTranslation()
  const registrySupport = useImageGenerationSupport(painting.providerId, painting.model)
  const configItems = useMemo(
    () => imageGenerationToFields(registrySupport, { mode: tabToImageGenerationMode(painting.mode) }),
    [registrySupport, painting.mode]
  )
  const ratio = useMemo(() => resolveRatio(painting.params, configItems), [painting.params, configItems])

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
  // declared-ratio box below when dimensions aren't known yet (decode failed,
  // or `container` unmeasured).
  let lockedSize: { width: number; height: number } | null = null
  if (naturalWidth && naturalHeight && naturalWidth > 0 && naturalHeight > 0 && container && availableHeight != null) {
    const scale = Math.min(1, container.width / naturalWidth, availableHeight / naturalHeight)
    lockedSize = { width: naturalWidth * scale, height: naturalHeight * scale }
  }

  // Match the real image's `max-h-full max-w-full` + `object-contain` — constrain
  // whichever axis is the tighter fit, same as the browser does for the `<img>`.
  // Pixel values (not `%`) once measured so the top bar's height comes out of
  // the constrained axis the same way `lockedSize` already does; falls back to
  // `SKELETON_MAX_SIZE` before the first measurement (avoids a collapsed box).
  const boxStyle: CSSProperties | undefined = lockedSize
    ? { width: lockedSize.width, height: lockedSize.height }
    : ratio == null
      ? undefined
      : containerRatio != null && ratio < containerRatio && availableHeight != null
        ? { height: availableHeight, width: 'auto', aspectRatio: String(ratio) }
        : {
            width: hasMeasuredWidth && container ? container.width : SKELETON_MAX_SIZE,
            height: 'auto',
            aspectRatio: String(ratio)
          }

  // The box's size is known (locked or ratio-derived) whenever boxStyle is set —
  // shrink-wrap the [topBar, box] column to it so the bar matches the box's width
  // instead of the full available area. Falls back to filling the area (box grows
  // via flex-1) when no ratio is known at all.
  const hasKnownSize = boxStyle != null

  return (
    <div
      ref={wrapperRef}
      className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label={t('paintings.generating')}>
      <div className={cn('flex flex-col items-stretch', hasKnownSize ? 'max-h-full max-w-full' : 'h-full w-full')}>
        {topBar && (
          <div ref={setTopBarRef} data-testid="painting-skeleton-top-bar-measure">
            {topBar}
          </div>
        )}
        <div className={cn('overflow-hidden rounded-md bg-muted', !hasKnownSize && 'min-h-0 flex-1')} style={boxStyle}>
          <PaintingSkeletonGrid blurhash={blurhash} imageUrl={imageUrl} onRevealReady={onRevealReady} />
        </div>
      </div>
    </div>
  )
}

export default PaintingImageSkeleton
