import React from 'react'

export interface ProgressBarProps {
  start: number
  progress: number
  height?: number
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ start = 0, progress, height = 6 }) => {
  const displayProgress = Math.min(100, Math.max(0, progress))

  return (
    <div className="mt-2 w-full min-w-0 overflow-hidden bg-muted" style={{ borderRadius: height }}>
      <div
        className="bg-success transition-[width] duration-300 ease-in-out"
        style={{
          width: `${displayProgress}%`,
          height: height,
          borderRadius: height,
          marginLeft: `${start}%`
        }}
      />
    </div>
  )
}
