import type { InputHTMLAttributes, ReactNode } from 'react'
import React from 'react'

const itemHandler = (onSelect: ((event: Event) => void) | undefined, props: Record<string, unknown>) => ({
  ...props,
  'data-disabled': props.disabled ? '' : undefined,
  disabled: props.disabled as boolean | undefined,
  onClick: (event: Event) => onSelect?.(event),
  type: 'button'
})

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
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
  DialogContent: ({ children, showCloseButton, ...props }: any) => {
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
  EmptyState: ({ description, title }: { description?: string; title: string }) => (
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
  FieldError: ({ children, ...props }: { children?: ReactNode }) => <p {...props}>{children}</p>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: ({ children, ...props }: { children?: ReactNode }) => <label {...props}>{children}</label>,
  RowFlex: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
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
  Skeleton: (props: Record<string, unknown>) => <div {...props} />
}
