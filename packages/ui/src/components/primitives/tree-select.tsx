'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../lib/utils'
import { Button } from './button'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

const treeSelectTriggerVariants = cva(
  cn(
    'inline-flex items-center justify-between rounded-md border-1 text-sm transition-colors outline-none font-normal',
    'bg-zinc-50 dark:bg-zinc-900',
    'text-foreground'
  ),
  {
    variants: {
      state: {
        default: 'border-border aria-expanded:border-primary aria-expanded:ring-3 aria-expanded:ring-primary/20',
        error: 'border border-destructive! aria-expanded:ring-3 aria-expanded:ring-red-600/20',
        disabled: 'opacity-50 cursor-not-allowed pointer-events-none'
      },
      size: {
        sm: 'h-8 px-2 text-xs gap-1',
        default: 'h-9 px-3 gap-2',
        lg: 'h-10 px-4 gap-2'
      }
    },
    defaultVariants: {
      state: 'default',
      size: 'default'
    }
  }
)

export interface TreeSelectOption {
  value: string
  title?: React.ReactNode
  label?: React.ReactNode
  children?: TreeSelectOption[]
  disabled?: boolean
  selectable?: boolean
  icon?: React.ReactNode
  isLeaf?: boolean
  key?: React.Key
  searchText?: string
}

export interface TreeSelectRenderState {
  depth: number
  expanded: boolean
  hasChildren: boolean
  selected: boolean
}

export interface TreeSelectProps extends Omit<VariantProps<typeof treeSelectTriggerVariants>, 'state'> {
  treeData: TreeSelectOption[]
  value?: string
  defaultValue?: string
  onChange?: (value: string, option: TreeSelectOption) => void
  renderOption?: (option: TreeSelectOption, state: TreeSelectRenderState) => React.ReactNode
  renderValue?: (option: TreeSelectOption) => React.ReactNode
  searchable?: boolean
  searchPlaceholder?: string
  emptyText?: string
  filterOption?: (option: TreeSelectOption, search: string) => boolean
  defaultExpandAll?: boolean
  defaultExpandedValues?: string[]
  expandedValues?: string[]
  onExpandedValuesChange?: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
  error?: boolean
  className?: string
  popoverClassName?: string
  triggerStyle?: React.CSSProperties
  width?: string | number
  maxHeight?: number
  name?: string
}

interface VisibleTreeNode {
  option: TreeSelectOption
  children: VisibleTreeNode[]
}

function getOptionLabel(option: TreeSelectOption) {
  return option.label ?? option.title ?? option.value
}

function nodeToText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(nodeToText).join(' ')
  }

  return ''
}

function getOptionSearchText(option: TreeSelectOption) {
  return [option.searchText, nodeToText(option.label), nodeToText(option.title), option.value]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function findOption(options: TreeSelectOption[], value: string): TreeSelectOption | undefined {
  for (const option of options) {
    if (option.value === value) {
      return option
    }

    const child = option.children ? findOption(option.children, value) : undefined
    if (child) {
      return child
    }
  }

  return undefined
}

function collectExpandableValues(options: TreeSelectOption[]) {
  const values: string[] = []

  for (const option of options) {
    if (option.children?.length) {
      values.push(option.value)
      values.push(...collectExpandableValues(option.children))
    }
  }

  return values
}

function toVisibleTree(options: TreeSelectOption[], search: string, filterOption?: TreeSelectProps['filterOption']) {
  const normalizedSearch = search.trim().toLowerCase()

  return options.reduce<VisibleTreeNode[]>((nodes, option) => {
    const children = option.children ? toVisibleTree(option.children, search, filterOption) : []
    const matches = !normalizedSearch
      ? true
      : filterOption
        ? filterOption(option, search)
        : getOptionSearchText(option).includes(normalizedSearch)

    if (matches || children.length > 0) {
      nodes.push({ option, children })
    }

    return nodes
  }, [])
}

export function TreeSelect({
  treeData,
  value: controlledValue,
  defaultValue,
  onChange,
  renderOption,
  renderValue,
  searchable = true,
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  filterOption,
  defaultExpandAll = false,
  defaultExpandedValues,
  expandedValues: controlledExpandedValues,
  onExpandedValuesChange,
  placeholder = 'Please Select',
  disabled = false,
  error = false,
  className,
  popoverClassName,
  triggerStyle,
  width,
  maxHeight = 320,
  size,
  name
}: TreeSelectProps) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const [search, setSearch] = React.useState('')
  const [internalExpandedValues, setInternalExpandedValues] = React.useState<string[]>(() => {
    if (defaultExpandedValues) {
      return defaultExpandedValues
    }

    return defaultExpandAll ? collectExpandableValues(treeData) : []
  })
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (controlledExpandedValues === undefined && defaultExpandAll) {
      setInternalExpandedValues(collectExpandableValues(treeData))
    }
  }, [controlledExpandedValues, defaultExpandAll, treeData])

  const value = controlledValue ?? internalValue
  const selectedOption = value !== undefined ? findOption(treeData, value) : undefined
  const expandedValues = controlledExpandedValues ?? internalExpandedValues
  const expandedSet = React.useMemo(() => new Set(expandedValues), [expandedValues])
  const visibleTree = React.useMemo(
    () => toVisibleTree(treeData, search, filterOption),
    [filterOption, search, treeData]
  )
  const triggerWidth = width ? (typeof width === 'number' ? `${width}px` : width) : undefined
  const state = disabled ? 'disabled' : error ? 'error' : 'default'
  const hasSearch = search.trim().length > 0

  const setExpandedValues = React.useCallback(
    (nextValues: string[]) => {
      if (controlledExpandedValues === undefined) {
        setInternalExpandedValues(nextValues)
      }

      onExpandedValuesChange?.(nextValues)
    },
    [controlledExpandedValues, onExpandedValuesChange]
  )

  const toggleExpanded = React.useCallback(
    (optionValue: string) => {
      const nextValues = expandedSet.has(optionValue)
        ? expandedValues.filter((value) => value !== optionValue)
        : [...expandedValues, optionValue]

      setExpandedValues(nextValues)
    },
    [expandedSet, expandedValues, setExpandedValues]
  )

  const handleOpenChange = (nextOpen: boolean) => {
    setInternalOpen(nextOpen)

    if (!nextOpen) {
      setSearch('')
    }
  }

  const handleSelect = (option: TreeSelectOption) => {
    if (option.disabled) {
      return
    }

    if (option.selectable === false) {
      if (option.children?.length) {
        toggleExpanded(option.value)
      }
      return
    }

    if (controlledValue === undefined) {
      setInternalValue(option.value)
    }

    onChange?.(option.value, option)
    handleOpenChange(false)
  }

  const renderTriggerContent = () => {
    if (!selectedOption) {
      return <span className="truncate text-muted-foreground">{placeholder}</span>
    }

    if (renderValue) {
      return renderValue(selectedOption)
    }

    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
        {selectedOption.icon && <span className="shrink-0">{selectedOption.icon}</span>}
        <span className="truncate">{getOptionLabel(selectedOption)}</span>
      </div>
    )
  }

  const renderOptionContent = (option: TreeSelectOption, renderState: TreeSelectRenderState) => {
    if (renderOption) {
      return renderOption(option, renderState)
    }

    return (
      <>
        {option.icon && <span className="shrink-0">{option.icon}</span>}
        <span className="min-w-0 flex-1 truncate">{getOptionLabel(option)}</span>
        {renderState.selected && <Check className="size-4 shrink-0 text-primary" />}
      </>
    )
  }

  const renderNodes = (nodes: VisibleTreeNode[], depth = 0) =>
    nodes.map(({ option, children }) => {
      const hasChildren = children.length > 0 || Boolean(option.children?.length)
      const expanded = hasSearch || expandedSet.has(option.value)
      const selected = value === option.value
      const rowState = { depth, expanded, hasChildren, selected }
      const rowKey = option.key ?? option.value

      return (
        <React.Fragment key={rowKey}>
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
            {hasChildren ? (
              <button
                type="button"
                aria-label={expanded ? 'Collapse' : 'Expand'}
                aria-expanded={expanded}
                onClick={() => toggleExpanded(option.value)}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
              </button>
            ) : (
              <span className="size-6 shrink-0" />
            )}
            <button
              type="button"
              role="treeitem"
              aria-selected={selected}
              disabled={option.disabled}
              onClick={() => handleSelect(option)}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors',
                selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent/60',
                option.disabled && 'pointer-events-none opacity-50',
                option.selectable === false && 'text-muted-foreground'
              )}>
              {renderOptionContent(option, rowState)}
            </button>
          </div>
          {hasChildren && expanded && children.length > 0 && renderNodes(children, depth + 1)}
        </React.Fragment>
      )
    })

  return (
    <Popover open={internalOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          style={{ width: triggerWidth, ...triggerStyle }}
          className={cn(treeSelectTriggerVariants({ state, size }), className)}
          role="combobox"
          aria-expanded={internalOpen}
          aria-invalid={error}>
          {renderTriggerContent()}
          <ChevronDown
            className={cn('size-4 shrink-0 opacity-50 transition-transform', internalOpen && 'rotate-180')}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-(--radix-popover-trigger-width) rounded-md p-1', popoverClassName)}
        style={{ width: triggerWidth }}
        onOpenAutoFocus={(event) => {
          if (!searchable) {
            return
          }

          event.preventDefault()
          searchInputRef.current?.focus()
        }}>
        {searchable && (
          <div className="border-b p-1">
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 shadow-none"
            />
          </div>
        )}
        <div
          role="tree"
          className="overflow-y-auto py-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/40 [&::-webkit-scrollbar]:w-1"
          style={{ maxHeight }}>
          {visibleTree.length > 0 ? (
            renderNodes(visibleTree)
          ) : (
            <div className="px-2 py-6 text-center text-muted-foreground text-sm">{emptyText}</div>
          )}
        </div>
      </PopoverContent>
      {name && <input type="hidden" name={name} value={value ?? ''} />}
    </Popover>
  )
}
