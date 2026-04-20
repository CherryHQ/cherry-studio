'use client'

import { cn } from '@cherrystudio/ui/lib/utils'

type CircularProgressProps = {
  value: number
  renderLabel?: (progress: number) => number | string
  size?: number
  strokeWidth?: number
  circleStrokeWidth?: number
  progressStrokeWidth?: number
  shape?: 'square' | 'round'
  className?: string
  progressClassName?: string
  labelClassName?: string
  showLabel?: boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const CircularProgress = ({
  value,
  renderLabel,
  className,
  progressClassName,
  labelClassName,
  showLabel = false,
  shape = 'round',
  size = 100,
  strokeWidth,
  circleStrokeWidth = 10,
  progressStrokeWidth = 10
}: CircularProgressProps) => {
  const normalizedValue = clamp(value, 0, 100)
  const resolvedCircleWidth = strokeWidth ?? circleStrokeWidth
  const resolvedProgressWidth = strokeWidth ?? progressStrokeWidth
  const maxStrokeWidth = Math.max(resolvedCircleWidth, resolvedProgressWidth)
  const radius = size / 2 - maxStrokeWidth / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - normalizedValue / 100)

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
        className="block">
        <circle
          r={radius}
          cx={size / 2}
          cy={size / 2}
          fill="transparent"
          strokeWidth={resolvedCircleWidth}
          strokeDasharray={circumference}
          strokeDashoffset="0"
          className={cn('stroke-primary/25', className)}
        />
        <circle
          r={radius}
          cx={size / 2}
          cy={size / 2}
          strokeWidth={resolvedProgressWidth}
          strokeLinecap={shape}
          strokeDashoffset={offset}
          fill="transparent"
          strokeDasharray={circumference}
          className={cn('stroke-primary', progressClassName)}
        />
      </svg>
      {showLabel && (
        <div className={cn('absolute inset-0 flex items-center justify-center text-sm', labelClassName)}>
          {renderLabel ? renderLabel(normalizedValue) : normalizedValue}
        </div>
      )}
    </div>
  )
}

export default CircularProgress
export type { CircularProgressProps }
