import { TooltipContent, TooltipRoot, TooltipTrigger } from 'prosekit/react/tooltip'
import type { ReactNode } from 'react'
import styled from 'styled-components'

export default function Button({
  pressed,
  disabled,
  onClick,
  tooltip,
  children
}: {
  pressed?: boolean
  disabled?: boolean
  onClick?: VoidFunction
  tooltip?: string
  children: ReactNode
}) {
  return (
    <TooltipRoot>
      <StyledTooltipTrigger>
        <StyledButton
          type="button"
          data-state={pressed ? 'on' : 'off'}
          disabled={disabled}
          onClick={() => onClick?.()}
          onMouseDown={(event) => event.preventDefault()}
          $pressed={pressed}>
          {children}
          {tooltip ? <ScreenReaderOnly>{tooltip}</ScreenReaderOnly> : null}
        </StyledButton>
      </StyledTooltipTrigger>
      {tooltip ? <StyledTooltipContent>{tooltip}</StyledTooltipContent> : null}
    </TooltipRoot>
  )
}

const StyledTooltipTrigger = styled(TooltipTrigger)`
  display: block;
`

const StyledButton = styled.button<{ $pressed?: boolean }>`
  outline: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  padding: 0.5rem;
  font-weight: 500;
  transition: all 0.15s ease-in-out;
  font-size: 0.875rem;
  min-width: 2.25rem;
  min-height: 2.25rem;
  border: none;
  background-color: transparent;
  cursor: pointer;

  &:focus-visible {
    outline: unset;
    box-shadow: 0 0 0 2px rgb(17 24 39);
  }

  &:disabled {
    pointer-events: none;
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:hover:not(:disabled) {
    background-color: var(--color-hover);
  }

  &[data-state='on'] {
    background-color: var(--color-background-mute);
  }

  &:focus-visible {
    box-shadow: 0 0 0 2px rgb(209 213 219);
  }
`

const ScreenReaderOnly = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`

const StyledTooltipContent = styled(TooltipContent)`
  z-index: 50;
  overflow: hidden;
  border-radius: 0.375rem;
  border: 1px solid;
  background-color: var();
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text-1);
  box-shadow:
    0 4px 6px -1px rgb(0 0 0 / 0.1),
    0 2px 4px -2px rgb(0 0 0 / 0.1);
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

  &[data-side='bottom'] {
    animation:
      fade-in 150ms ease-out,
      slide-in-from-top 150ms ease-out;
  }

  &[data-side='left'] {
    animation:
      fade-in 150ms ease-out,
      slide-in-from-right 150ms ease-out;
  }

  &[data-side='right'] {
    animation:
      fade-in 150ms ease-out,
      slide-in-from-left 150ms ease-out;
  }

  &[data-side='top'] {
    animation:
      fade-in 150ms ease-out,
      slide-in-from-bottom 150ms ease-out;
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

  @keyframes slide-in-from-top {
    from {
      transform: translateY(-0.5rem);
    }
    to {
      transform: translateY(0);
    }
  }

  @keyframes slide-in-from-bottom {
    from {
      transform: translateY(0.5rem);
    }
    to {
      transform: translateY(0);
    }
  }

  @keyframes slide-in-from-left {
    from {
      transform: translateX(-0.5rem);
    }
    to {
      transform: translateX(0);
    }
  }

  @keyframes slide-in-from-right {
    from {
      transform: translateX(0.5rem);
    }
    to {
      transform: translateX(0);
    }
  }
`
