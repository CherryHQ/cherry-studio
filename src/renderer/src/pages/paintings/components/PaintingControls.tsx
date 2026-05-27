import type { ButtonVariant } from '@cherrystudio/ui'
import {
  Button,
  ConfirmDialog,
  EditableNumber,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Slider
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Upload } from 'lucide-react'
import type { ChangeEvent, ComponentProps, ReactNode } from 'react'
import { useRef, useState } from 'react'

export interface NumberFieldProps {
  value?: number | null
  min?: number
  max?: number
  step?: number
  placeholder?: string
  className?: string
  block?: boolean
  onChange?: (value: number | null) => void
}

export function NumberField({ className, onChange, block = true, ...props }: NumberFieldProps) {
  return (
    <EditableNumber block={block} align="start" className={cn('w-full', className)} onChange={onChange} {...props} />
  )
}

export interface SliderFieldProps {
  value?: number
  min?: number
  max?: number
  step?: number
  className?: string
  onChange?: (value: number) => void
}

export function SliderField({ value, min, max, step, className, onChange }: SliderFieldProps) {
  return (
    <Slider
      className={cn('flex-1', className)}
      min={min}
      max={max}
      step={step}
      value={[value ?? min ?? 0]}
      onValueChange={(nextValue) => onChange?.(nextValue[0] ?? min ?? 0)}
    />
  )
}

export interface TextInputProps extends Omit<ComponentProps<typeof Input>, 'onChange' | 'prefix'> {
  prefix?: ReactNode
  suffix?: ReactNode
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
}

export function TextInput({ prefix, suffix, className, onChange, ...props }: TextInputProps) {
  if (!prefix && !suffix) {
    return <Input className={className} onChange={onChange} {...props} />
  }

  return (
    <InputGroup>
      {prefix && <InputGroupAddon align="inline-start">{prefix}</InputGroupAddon>}
      <InputGroupInput className={className} onChange={onChange} {...props} />
      {suffix && <InputGroupAddon align="inline-end">{suffix}</InputGroupAddon>}
    </InputGroup>
  )
}

export interface FilePickerProps {
  accept?: string
  multiple?: boolean
  disabled?: boolean
  className?: string
  children?: ReactNode
  onFiles: (files: File[]) => void
}

export function FilePicker({ accept, multiple, disabled, className, children, onFiles }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      className={cn('cursor-pointer aria-disabled:cursor-not-allowed aria-disabled:opacity-50', className)}
      onClick={() => {
        if (!disabled) {
          inputRef.current?.click()
        }
      }}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) {
            onFiles(files)
          }
          event.target.value = ''
        }}
      />
      {children ?? <Upload className="size-4" />}
    </div>
  )
}

interface ConfirmActionProps {
  title: ReactNode
  confirmText: string
  cancelText: string
  destructive?: boolean
  children: ReactNode
  onConfirm: () => void | Promise<void>
}

export function ConfirmAction({
  title,
  confirmText,
  cancelText,
  destructive = false,
  children,
  onConfirm
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <span className="contents" onClick={() => setOpen(true)}>
        {children}
      </span>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        confirmText={confirmText}
        cancelText={cancelText}
        destructive={destructive}
        onConfirm={onConfirm}
      />
    </>
  )
}

interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'variant'> {
  variant?: ButtonVariant
}

export function IconButton({ className, variant = 'ghost', size = 'icon-sm', ...props }: IconButtonProps) {
  return <Button variant={variant} size={size} className={cn('shrink-0', className)} {...props} />
}
