import { TailwindDemo } from '@renderer/components/TailwindDemo'
import React, { useState } from 'react'

interface TestButtonProps {
  label?: string
  onClick?: () => void
  variant?: 'primary' | 'secondary'
}

export const TestButton: React.FC<TestButtonProps> = ({ label = 'Click me', onClick, variant = 'primary' }) => {
  const [clickCount, setClickCount] = useState(0)
  const [showDemo, setShowDemo] = useState(false)

  const handleClick = () => {
    setClickCount((prev) => prev + 1)
    onClick?.()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <button
          className={`px-4 py-2 rounded transition-colors ${
            variant === 'primary'
              ? 'bg-blue-500 hover:bg-blue-600 text-white'
              : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
          }`}
          onClick={handleClick}>
          {label} (clicked {clickCount} times)
        </button>

        <button
          className="px-4 py-2 rounded transition-colors bg-green-500 hover:bg-green-600 text-white"
          onClick={() => setShowDemo(!showDemo)}>
          {showDemo ? 'Hide' : 'Show'} Tailwind Demo
        </button>
      </div>

      {showDemo && <TailwindDemo />}
    </div>
  )
}
