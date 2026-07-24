import type { InputHTMLAttributes, ReactNode } from 'react'
import React from 'react'

const itemHandler = (onSelect: ((event: Event) => void) | undefined, props: Record<string, unknown>) => ({
  ...props,
  'data-disabled': props.disabled ? '' : undefined,
  disabled: props.disabled as boolean | undefined,
  onClick: (event: Event) => onSelect?.(event),
  type: 'button'
})

const SelectContext = React.createContext<{ onValueChange?: (value: string) => void; value?: string }>({})

export const MockCherrystudioUI = {
  Button: ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean }) => {
    void loading
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <button
      {...props}
      type="button"
      role="checkbox"
      aria-checked={checked === 'indeterminate' ? 'mixed' : Boolean(checked)}
      onClick={(event) => {
        props.onClick?.(event)
        onCheckedChange?.(!checked)
      }}
    />
  ),
  Combobox: ({ options, value, onChange, placeholder, searchPlaceholder, emptyText, ...props }: any) => {
    void searchPlaceholder
    void emptyText
    const selected = options.find((option: { value: string }) => option.value === value)
    return (
      <div {...props}>
        <button type="button" aria-label={placeholder}>
          {selected ? selected.label : placeholder}
        </button>
        {options.map((option: { value: string; label: ReactNode; icon?: ReactNode }) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}>
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    )
  },
  ConfirmDialog: ({
    cancelText,
    confirmText,
    content,
    contentClassName,
    description,
    onConfirm,
    open,
    overlayClassName,
    title
  }: any) =>
    open ? (
      <div role="dialog" className={contentClassName} data-overlay-class={overlayClassName}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {content}
        <button type="button">{cancelText ?? 'Cancel'}</button>
        <button type="button" onClick={onConfirm}>
          {confirmText ?? 'Confirm'}
        </button>
      </div>
    ) : null,
  ContextMenu: ({ children }: { children?: ReactNode }) => <div data-testid="context-menu">{children}</div>,
  ContextMenuContent: ({ children, className, ...props }: { children?: ReactNode; className?: string }) => (
    <div data-testid="context-menu-content" className={['z-50', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  ),
  ContextMenuItem: ({ children, onSelect, ...props }: any) =>
    React.createElement('button', itemHandler(onSelect, props), children),
  ContextMenuItemContent: ({ children, icon, shortcut, ...props }: any) => (
    <span {...props}>
      {icon}
      {children}
      {shortcut ? <span>{shortcut}</span> : null}
    </span>
  ),
  ContextMenuSeparator: (props: any) => <hr data-testid="context-menu-separator" {...props} />,
  ContextMenuShortcut: ({ children, ...props }: { children?: ReactNode }) => <span {...props}>{children}</span>,
  ContextMenuSub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ContextMenuSubContent: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  ContextMenuSubTrigger: ({ children, ...props }: { children?: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ContextMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  CustomTag: ({ children, ...props }: { children?: ReactNode }) => <span {...props}>{children}</span>,
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
  DialogContent: ({ children, closeOnOverlayClick, showCloseButton, ...props }: any) => {
    void closeOnOverlayClick
    void showCloseButton
    return (
      <div role="dialog" {...props}>
        {children}
      </div>
    )
  },
  DialogFooter: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }: { children?: ReactNode }) => <h2 {...props}>{children}</h2>,
  EmptyState: ({
    description,
    title,
    actionLabel,
    onAction
  }: {
    description?: string
    title: string
    actionLabel?: string
    onAction?: () => void
  }) => (
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {actionLabel && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  ),
  FieldError: ({ children, ...props }: { children?: ReactNode }) => <p {...props}>{children}</p>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: ({ children, ...props }: { children?: ReactNode }) => <label {...props}>{children}</label>,
  RowFlex: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  Scrollbar: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  Select: ({ children, onValueChange, value, ...props }: any) => (
    <SelectContext.Provider value={{ onValueChange, value }}>
      <div data-testid="select" data-value={value} {...props}>
        {children}
      </div>
    </SelectContext.Provider>
  ),
  SelectDropdown: ({ items, onSelect, renderItem, renderSelected, selectedId, placeholder }: any) => {
    const selected = items.find((item: { id: string }) => item.id === selectedId)
    return (
      <div>
        <button type="button" aria-label={placeholder}>
          {selected ? renderSelected(selected) : placeholder}
        </button>
        {items.map((item: { id: string }) => (
          <button type="button" key={item.id} onClick={() => onSelect(item.id)}>
            {renderItem(item, item.id === selectedId)}
          </button>
        ))}
      </div>
    )
  },
  SelectContent: ({ children, ...props }: any) => (
    <div data-testid="select-content" {...props}>
      {children}
    </div>
  ),
  SelectItem: ({ children, value, ...props }: any) => {
    const context = React.useContext(SelectContext)
    return (
      <button
        {...props}
        type="button"
        data-testid="select-item"
        data-value={value}
        onClick={(event) => {
          props.onClick?.(event)
          context.onValueChange?.(value)
        }}>
        {children}
      </button>
    )
  },
  SelectTrigger: ({ children, ...props }: any) => (
    <button type="button" data-testid="select-trigger" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ children, placeholder, ...props }: any) => (
    <span data-testid="select-value" {...props}>
      {children ?? placeholder}
    </span>
  ),
  SearchInput: ({ value, onChange, onClear, clearLabel, ...props }: any) => (
    <div>
      <input type="search" value={value} onChange={onChange} {...props} />
      {onClear && clearLabel && value ? <button type="button" aria-label={clearLabel} onClick={onClear} /> : null}
    </div>
  ),
  SegmentedControl: ({ options, value, onValueChange, ...props }: any) => (
    <div role="radiogroup" {...props}>
      {options.map((option: { value: string; label: ReactNode }) => (
        <button
          type="button"
          role="radio"
          aria-checked={option.value === value}
          key={option.value}
          onClick={() => onValueChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Skeleton: (props: Record<string, unknown>) => <div {...props} />
}
