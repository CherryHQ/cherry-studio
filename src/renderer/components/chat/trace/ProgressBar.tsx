import React from 'react'

export interface ProgressBarProps {
  start: number
  progress: number
  height?: number
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ start = 0, progress, height = 6 }) => {
  const displayProgress = Math.max(0, progress)

  return (
    <div
      className="trace-progress-track"
      style={{
        width: '100%',
        borderRadius: height,
        overflow: 'hidden',
        marginTop: '8px'
      }}>
      <div
        className="trace-progress-fill"
        style={{
          width: `${displayProgress}%`,
          height: height,
          borderRadius: height,
          transition: 'width 0.3s ease',
          marginLeft: `${start}%`
        }}
      />
    </div>
  )
}
