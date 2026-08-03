import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelectorRow } from '@renderer/components/ModelSelector'
import Scrollbar from '@renderer/components/Scrollbar'
import { DEFAULT_SELECTOR_CONTENT_HEIGHT, SelectorShell } from '@renderer/components/SelectorShell'
import { useListboxKeyboardNavigation } from '@renderer/components/useListboxKeyboardNavigation'
import { ChevronDown, Library } from 'lucide-react'
import { useMemo, useState } from 'react'

const KNOWLEDGE_BASE_ROW_HEIGHT = 36
const KNOWLEDGE_BASE_LIST_PADDING = 8
const KNOWLEDGE_BASE_EMPTY_LIST_HEIGHT = 80
const KNOWLEDGE_BASE_SHELL_CHROME_HEIGHT = 40

interface KnowledgeBaseSelectorOption {
  label: string
  value: string
  disabled?: boolean
}

interface KnowledgeBaseSelectorProps {
  value?: string
  options: KnowledgeBaseSelectorOption[]
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  invalid?: boolean
  'aria-label'?: string
  onChange: (value: string) => void
}

export const KnowledgeBaseSelector = ({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  invalid = false,
  'aria-label': ariaLabel,
  onChange
}: KnowledgeBaseSelectorProps) => {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const selectedOption = options.find((option) => option.value === value)
  const filteredOptions = useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    return query ? options.filter((option) => option.label.toLowerCase().includes(query)) : options
  }, [options, searchValue])
  const listHeight =
    filteredOptions.length > 0
      ? filteredOptions.length * KNOWLEDGE_BASE_ROW_HEIGHT + KNOWLEDGE_BASE_LIST_PADDING
      : KNOWLEDGE_BASE_EMPTY_LIST_HEIGHT
  const contentHeight = Math.min(DEFAULT_SELECTOR_CONTENT_HEIGHT, listHeight + KNOWLEDGE_BASE_SHELL_CHROME_HEIGHT)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setSearchValue('')
    }
  }

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    handleOpenChange(false)
  }

  const { activeIndex, activeOptionId, getOptionId, handleKeyDown, listboxId, listRef, setActiveIndex } =
    useListboxKeyboardNavigation({
      open,
      options: filteredOptions,
      value,
      onSelect: (option) => handleSelect(option.value)
    })

  return (
    <SelectorShell
      trigger={
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-9 w-full min-w-0 justify-between gap-2 rounded-md px-3 font-normal text-sm shadow-none',
            'aria-expanded:border-primary aria-expanded:ring-3 aria-expanded:ring-primary/20',
            selectedOption ? 'text-foreground' : 'text-muted-foreground',
            invalid && 'aria-invalid:border-error-border aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40'
          )}>
          <span className="min-w-0 truncate text-left">{selectedOption?.label ?? placeholder}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      }
      open={open}
      onOpenChange={handleOpenChange}
      width="var(--radix-popover-trigger-width)"
      contentHeight={contentHeight}
      search={{
        value: searchValue,
        onChange: setSearchValue,
        placeholder: searchPlaceholder,
        ariaControls: listboxId,
        activeDescendant: activeOptionId
      }}
      contentProps={{ onKeyDown: handleKeyDown }}
      data-testid="knowledge-base-selector-content">
      {({ availableListHeight }) => (
        <Scrollbar
          id={listboxId}
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          className="min-h-0 flex-1 px-1 py-1 outline-none"
          style={{ height: availableListHeight ?? listHeight }}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
              const selected = option.value === value
              const active = index === activeIndex

              return (
                <div
                  key={option.value}
                  className="py-0.5"
                  data-listbox-option-index={index}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index)
                  }}>
                  <ModelSelectorRow
                    selected={selected}
                    focused={active}
                    disabled={option.disabled}
                    showSelectedIndicator={selected}
                    leading={<Library className="size-4 shrink-0 text-muted-foreground" />}
                    onSelect={() => handleSelect(option.value)}
                    optionProps={{
                      id: getOptionId(index),
                      'aria-selected': selected,
                      'data-active': active || undefined
                    }}>
                    <span className="truncate">{option.label}</span>
                  </ModelSelectorRow>
                </div>
              )
            })
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-muted-foreground text-xs">
              {emptyText}
            </div>
          )}
        </Scrollbar>
      )}
    </SelectorShell>
  )
}
