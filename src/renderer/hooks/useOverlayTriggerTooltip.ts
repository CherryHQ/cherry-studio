import { useRef, useState } from 'react'

type TooltipTriggerElement = {
  blur?: () => void
}

export function useOverlayTriggerTooltip() {
  const suppressedRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)

  const onOpenChange = (nextOpen: boolean) => {
    if (suppressedRef.current && nextOpen) {
      return
    }

    setIsOpen(nextOpen)
  }

  const suppress = (trigger?: TooltipTriggerElement | null) => {
    trigger?.blur?.()
    suppressedRef.current = true
    setIsOpen(false)
  }

  const release = () => {
    suppressedRef.current = false
    setIsOpen(false)
  }

  return {
    tooltipProps: {
      isOpen,
      onOpenChange
    },
    triggerProps: {
      onPointerLeave: release
    },
    suppress
  }
}
