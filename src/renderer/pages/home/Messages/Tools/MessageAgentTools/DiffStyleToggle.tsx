import { Columns2, Rows2 } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import styled from 'styled-components'

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
    <ToggleButton onClick={onToggle}>
      <Icon size={14} className="tool-icon" />
    </ToggleButton>
  )
})

const ToggleButton = styled.button`
  position: absolute;
  right: 0.5rem;
  top: 0.5rem;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  background-color: var(--color-background-soft);
  color: var(--color-text-3);
  opacity: 0;
  transition: all 0.2s ease;

  .relative:hover & {
    opacity: 0.6;
  }

  &:hover {
    opacity: 1;
    .tool-icon {
      color: var(--color-text-1);
    }
  }
`
