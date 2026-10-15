// Adapted from ElevenLabs UI's BarVisualizer: https://github.com/elevenlabs/ui
// MIT license and attribution: packages/ui/licenses/elevenlabs-ui.txt
import { useEffect, useRef, type HTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

export type BarVisualizerState = 'listening' | 'speaking' | 'thinking'

export interface BarVisualizerProps extends HTMLAttributes<HTMLDivElement> {
  analyser?: AnalyserNode
  state?: BarVisualizerState
  barCount?: number
  minHeight?: number
  maxHeight?: number
}

export function BarVisualizer({
  analyser,
  state,
  barCount = 15,
  minHeight = 6,
  maxHeight = 100,
  className,
  ...props
}: BarVisualizerProps) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    const reset = () => bars.current.forEach((bar) => bar?.style.setProperty('height', `${minHeight}%`))
    reset()
    if (!analyser || (state !== 'speaking' && state !== 'listening')) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const frequencies = new Uint8Array(analyser.frequencyBinCount)
    const binWidth = analyser.context.sampleRate / analyser.fftSize
    const upperFrequency = Math.min(8_000, analyser.context.sampleRate / 2)
    let frame = 0
    let lastUpdate = 0

    const update = (timestamp: number) => {
      if (timestamp - lastUpdate >= 1000 / 30) {
        analyser.getByteFrequencyData(frequencies)
        for (let index = 0; index < barCount; index++) {
          const low = Math.floor((80 * (upperFrequency / 80) ** (index / barCount)) / binWidth)
          const high = Math.min(
            frequencies.length,
            Math.max(low + 1, Math.ceil((80 * (upperFrequency / 80) ** ((index + 1) / barCount)) / binWidth))
          )
          let total = 0
          for (let bin = low; bin < high; bin++) total += frequencies[bin]
          const volume = total / Math.max(1, high - low) / 255
          const height = Math.min(maxHeight, Math.max(minHeight, volume * 100))
          bars.current[index]?.style.setProperty('height', `${height}%`)
        }
        lastUpdate = timestamp
      }
      frame = requestAnimationFrame(update)
    }
    const synchronize = () => {
      cancelAnimationFrame(frame)
      if (document.hidden || reducedMotion.matches) reset()
      else frame = requestAnimationFrame(update)
    }

    synchronize()
    document.addEventListener('visibilitychange', synchronize)
    reducedMotion.addEventListener('change', synchronize)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', synchronize)
      reducedMotion.removeEventListener('change', synchronize)
      reset()
    }
  }, [analyser, state, barCount, minHeight, maxHeight])

  return (
    <div
      data-slot="bar-visualizer"
      data-state={state}
      className={cn('flex h-8 w-24 items-center justify-center gap-0.5 overflow-hidden text-primary', className)}
      {...props}>
      {Array.from({ length: barCount }, (_, index) => (
        <span
          key={index}
          ref={(bar) => {
            bars.current[index] = bar
          }}
          className="max-w-1 min-w-0 flex-1 rounded-full bg-current transition-[height] duration-150 ease-out motion-reduce:transition-none"
          style={{ height: `${minHeight}%` }}
        />
      ))}
    </div>
  )
}
