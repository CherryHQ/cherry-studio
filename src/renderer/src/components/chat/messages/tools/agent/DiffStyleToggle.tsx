import { Columns2, Rows2 } from 'lucide-react'
import { memo, useCallback, useState } from 'react'

export function useDiffStyle() {
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')
  const toggleDiffStyle = useCallback(() => {
    setDiffStyle((prev) => (prev === 'unified' ? 'split' : 'unified'))
  }, [])
  return { diffStyle, toggleDiffStyle }
}

export const DiffStyleToggle = memo(function DiffStyleToggle({
  diffStyle,
  onToggle
}: {
  diffStyle: 'unified' | 'split'
  onToggle: () => void
}) {
  const Icon = diffStyle === 'unified' ? Columns2 : Rows2

  return (
    <button
      type="button"
      className="absolute top-2 right-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded border-none bg-muted text-foreground-muted opacity-0 transition-all duration-200 ease-in-out hover:opacity-100 hover:[&_.tool-icon]:text-foreground [.relative:hover_&]:opacity-60"
      onClick={onToggle}>
      <Icon size={14} className="tool-icon" />
    </button>
  )
})
