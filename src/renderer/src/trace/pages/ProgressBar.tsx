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
      style={{
        width: '100%',
        backgroundColor: '#e0e0e0',
        borderRadius: height,
        overflow: 'hidden',
        marginTop: '8px'
      }}>
      <div
        style={{
          width: `${displayProgress}%`,
          height: height,
          backgroundColor: '#4CAF50',
          borderRadius: height,
          transition: 'width 0.3s ease',
          marginLeft: `${start}%`
        }}
      />
    </div>
  )
}
