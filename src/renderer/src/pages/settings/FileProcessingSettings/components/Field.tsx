import { Input } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { Eye, EyeOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TextFieldProps = {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  readOnly?: boolean
  type?: string
  placeholder?: string
  action?: ReactNode
  description?: ReactNode
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  readOnly,
  type,
  placeholder,
  action,
  description
}: TextFieldProps) {
  const inputId = useId()

  return (
    <div className="block">
      <div className="mb-1.5">
        <label htmlFor={inputId} className="text-foreground/55 text-xs leading-tight">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-foreground/25 text-xs leading-tight">{description}</p> : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border/30 bg-foreground/[0.03] px-2.5 py-[5px]">
          <Input
            id={inputId}
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            readOnly={readOnly}
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

type PasswordFieldProps = Omit<TextFieldProps, 'type'>

export function PasswordField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  action,
  description
}: PasswordFieldProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const [visible, setVisible] = useState(false)

  return (
    <div className="block">
      <div className="mb-1.5">
        <label htmlFor={inputId} className="text-foreground/55 text-xs leading-tight">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-foreground/25 text-xs leading-tight">{description}</p> : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border/30 bg-foreground/[0.03] px-2.5 py-[5px]">
          <Input
            id={inputId}
            type={visible ? 'text' : 'password'}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            spellCheck={false}
            className={cn(
              'h-auto flex-1 border-0 bg-transparent p-0 text-foreground/60 text-xs leading-tight shadow-none outline-none',
              'placeholder:text-foreground/20 focus-visible:ring-0 focus-visible:ring-offset-0'
            )}
          />
          <button
            type="button"
            className="ml-1.5 shrink-0 text-foreground/20 transition-colors hover:text-foreground/40"
            aria-label={
              visible
                ? t('settings.tool.file_processing.actions.hide_api_key')
                : t('settings.tool.file_processing.actions.show_api_key')
            }
            onClick={(event) => {
              event.preventDefault()
              setVisible((current) => !current)
            }}>
            {visible ? <EyeOff size={10} /> : <Eye size={10} />}
          </button>
        </div>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
