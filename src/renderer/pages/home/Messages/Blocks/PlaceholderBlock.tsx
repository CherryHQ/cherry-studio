import React from 'react'
import { BeatLoader } from 'react-spinners'

interface PlaceholderBlockProps {
  isProcessing: boolean
}
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ isProcessing }) => {
  if (isProcessing) {
    return (
      <div className="-mt-1.25 mb-1.25 flex h-8 flex-row items-center">
        <BeatLoader color="var(--color-foreground)" size={8} speedMultiplier={0.8} />
      </div>
    )
  }
  return null
}
export default React.memo(PlaceholderBlock)
