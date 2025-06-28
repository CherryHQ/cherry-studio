import { GripVertical, Plus } from 'lucide-react'
import { BlockHandleAdd, BlockHandleDraggable, BlockHandlePopover } from 'prosekit/react/block-handle'
import styled from 'styled-components'

export default function BlockHandle() {
  return (
    <StyledBlockHandlePopover>
      <StyledBlockHandleAdd>
        <Plus size={20} />
      </StyledBlockHandleAdd>
      <StyledBlockHandleDraggable>
        <GripVertical size={20} />
      </StyledBlockHandleDraggable>
    </StyledBlockHandlePopover>
  )
}

const StyledBlockHandlePopover = styled(BlockHandlePopover)`
  display: flex;
  align-items: center;
  flex-direction: row;
  box-sizing: border-box;
  justify-content: center;
  transition: all 0.15s ease-in-out;
  border: 0;
  will-change: transform;

  &:not([data-state]) {
    display: none;
  }

  &[data-state='open'] {
    animation:
      fade-in 150ms ease-out,
      zoom-in 150ms ease-out;
  }

  &[data-state='closed'] {
    animation:
      fade-out 200ms ease-out,
      zoom-out 200ms ease-out;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  @keyframes zoom-in {
    from {
      transform: scale(0.95);
    }
    to {
      transform: scale(1);
    }
  }

  @keyframes zoom-out {
    from {
      transform: scale(1);
    }
    to {
      transform: scale(0.95);
    }
  }
`

const StyledBlockHandleAdd = styled(BlockHandleAdd)`
  display: flex;
  align-items: center;
  box-sizing: border-box;
  justify-content: center;
  height: 1.5em;
  width: 1.5em;
  border-radius: 0.25rem;
  color: rgba(107, 114, 128, 0.5);
  cursor: pointer;
  transition: all 0.15s ease-in-out;

  &:hover {
    background-color: var(--color-hover);
  }
`

const StyledBlockHandleDraggable = styled(BlockHandleDraggable)`
  display: flex;
  align-items: center;
  box-sizing: border-box;
  justify-content: center;
  height: 1.5em;
  width: 1.2em;
  border-radius: 0.25rem;
  color: rgba(107, 114, 128, 0.5);
  cursor: grab;
  transition: all 0.15s ease-in-out;

  &:hover {
    background-color: var(--color-hover);
  }
`
