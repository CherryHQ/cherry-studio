import { Input } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Eye, EyeOff } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useId, useState } from 'react'

type FieldProps = {
  label?: ReactNode
  help?: ReactNode
  children: ReactNode
  className?: string
}

type TextFieldProps = {
  label?: ReactNode
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  help?: ReactNode
  action?: ReactNode
  autoFocus?: boolean
  className?: string
}

type PasswordFieldProps = TextFieldProps & {
  hideLabel: string
  showLabel: string
}

export const Field: FC<FieldProps> = ({ label, help, children, className }) => (
  <div className={className}>
    {label || help ? (
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {label ? <label className="text-foreground/55 text-xs leading-tight">{label}</label> : null}
          {help}
        </div>
      </div>
    ) : null}
    {children}
  </div>
)

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  help,
  action,
  autoFocus,
  className
}: TextFieldProps) {
  const inputId = useId()

  return (
    <div className={className}>
      {label || help ? (
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {label ? (
              <label htmlFor={inputId} className="text-foreground/55 text-xs leading-tight">
                {label}
              </label>
            ) : null}
            {help}
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border/30 bg-foreground/[0.03] px-2.5 py-[5px]">
          <Input
            id={inputId}
            aria-label={label ? undefined : placeholder}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            autoFocus={autoFocus}
            spellCheck={false}
            className={cn(
              'h-auto flex-1 border-0 bg-transparent p-0 text-foreground/60 text-xs leading-tight shadow-none outline-none',
              'placeholder:text-foreground/20 focus-visible:ring-0 focus-visible:ring-offset-0'
            )}
          />
        </div>
        {action}
      </div>
    </div>
  )
}

export function PasswordField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  help,
  action,
  autoFocus,
  className,
  hideLabel,
  showLabel
}: PasswordFieldProps) {
  const inputId = useId()
  const [visible, setVisible] = useState(false)

  return (
    <div className={className}>
      {label || help ? (
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {label ? (
              <label htmlFor={inputId} className="text-foreground/55 text-xs leading-tight">
                {label}
              </label>
            ) : null}
            {help}
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border/30 bg-foreground/[0.03] px-2.5 py-[5px]">
          <Input
            id={inputId}
            aria-label={label ? undefined : placeholder}
            type={visible ? 'text' : 'password'}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            autoFocus={autoFocus}
            spellCheck={false}
            className={cn(
              'h-auto flex-1 border-0 bg-transparent p-0 text-foreground/60 text-xs leading-tight shadow-none outline-none',
              'placeholder:text-foreground/20 focus-visible:ring-0 focus-visible:ring-offset-0'
            )}
          />
          <button
            type="button"
            className="ml-1.5 flex size-5 shrink-0 items-center justify-center rounded-md text-foreground/20 transition-colors hover:text-foreground/40"
            aria-label={visible ? hideLabel : showLabel}
            onClick={(event) => {
              event.preventDefault()
              setVisible((current) => !current)
            }}>
            {visible ? <EyeOff size={10} /> : <Eye size={10} />}
          </button>
        </div>
        {action}
      </div>
    </div>
  )
}
