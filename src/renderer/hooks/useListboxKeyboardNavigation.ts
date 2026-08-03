import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

interface ListboxNavigationOption {
  value: string
  disabled?: boolean
}

interface UseListboxKeyboardNavigationOptions<T extends ListboxNavigationOption> {
  open: boolean
  options: readonly T[]
  value?: string | null
  onSelect: (option: T) => void
}

export const useListboxKeyboardNavigation = <T extends ListboxNavigationOption>({
  open,
  options,
  value,
  onSelect
}: UseListboxKeyboardNavigationOptions<T>) => {
  const listboxId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1)
      return
    }

    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled))
  }, [open, options, value])

  useEffect(() => {
    if (activeIndex < 0) return

    const activeOption = listRef.current?.querySelector<HTMLElement>(`[data-listbox-option-index="${activeIndex}"]`)
    activeOption?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  const step = (from: number, direction: 1 | -1) => {
    for (let count = 0, index = from; count < options.length; count += 1) {
      index = (index + direction + options.length) % options.length
      if (!options[index]?.disabled) return index
    }
    return -1
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    // Some browsers only expose IME composition through the legacy keyCode value.
    // oxlint-disable-next-line no-deprecated
    if (event.nativeEvent.isComposing || event.keyCode === 229) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => step(index < 0 ? -1 : index, 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => step(index < 0 ? options.length : index, -1))
        return
      case 'Home':
        if (options.length === 0) return
        event.preventDefault()
        setActiveIndex(step(-1, 1))
        return
      case 'End':
        if (options.length === 0) return
        event.preventDefault()
        setActiveIndex(step(0, -1))
        return
      case 'Enter': {
        if (event.target instanceof HTMLElement && event.target.closest('button')) return
        const option = options[activeIndex]
        if (!option || option.disabled) return
        event.preventDefault()
        onSelect(option)
        return
      }
    }
  }

  const getOptionId = (index: number) => `${listboxId}-option-${index}`
  const activeOptionId = options[activeIndex] ? getOptionId(activeIndex) : undefined

  return {
    activeIndex,
    activeOptionId,
    getOptionId,
    handleKeyDown,
    listboxId,
    listRef,
    setActiveIndex
  }
}
