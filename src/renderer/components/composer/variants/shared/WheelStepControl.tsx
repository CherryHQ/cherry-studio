import { type ComponentPropsWithoutRef, useEffect, useEffectEvent, useRef } from 'react'

const WHEEL_STEP_THRESHOLD = 40
const WHEEL_IDLE_RESET_MS = 120

function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) return event.deltaY
  return Math.sign(event.deltaY) * WHEEL_STEP_THRESHOLD
}

interface WheelStepControlProps extends ComponentPropsWithoutRef<'div'> {
  value: number
  min: number
  max: number
  onValueChange: (value: number) => void
}

export function WheelStepControl({ children, value, min, max, onValueChange, ...props }: WheelStepControlProps) {
  const wheelTargetRef = useRef<HTMLDivElement>(null)
  const wheelDeltaRef = useRef(0)
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleWheel = useEffectEvent((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey || event.deltaY === 0) return

    const normalizedDelta = normalizeWheelDelta(event)
    const direction = normalizedDelta < 0 ? 1 : -1
    const nextValue = Math.min(Math.max(value + direction, min), max)

    if (nextValue === value) {
      wheelDeltaRef.current = 0
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (Math.sign(wheelDeltaRef.current) !== Math.sign(normalizedDelta)) wheelDeltaRef.current = 0
    wheelDeltaRef.current += normalizedDelta

    if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current)
    wheelIdleTimerRef.current = setTimeout(() => {
      wheelDeltaRef.current = 0
    }, WHEEL_IDLE_RESET_MS)

    if (Math.abs(wheelDeltaRef.current) < WHEEL_STEP_THRESHOLD) return

    wheelDeltaRef.current = 0
    onValueChange(nextValue)
  })

  useEffect(() => {
    const wheelTarget = wheelTargetRef.current
    if (!wheelTarget) return

    wheelTarget.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      wheelTarget.removeEventListener('wheel', handleWheel)
      if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current)
    }
    // `handleWheel` is an Effect Event that reads the latest value without re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={wheelTargetRef} data-slot="wheel-step-control" {...props}>
      {children}
    </div>
  )
}
