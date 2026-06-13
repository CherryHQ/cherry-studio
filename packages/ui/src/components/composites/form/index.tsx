'use client'

import { Label } from '@cherrystudio/ui/components/primitives/label'
import { cn } from '@cherrystudio/ui/lib/utils'
import type * as LabelPrimitive from '@radix-ui/react-label'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState
} from 'react-hook-form'

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  TTransformedValues = TFieldValues
>({ ...props }: ControllerProps<TFieldValues, TName, TTransformedValues>) {
  return (
    <FormFieldContext value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext>
  )
}

const useFormField = () => {
  const fieldContext = React.use(FormFieldContext)
  const itemContext = React.use(FormItemContext)

  if (!fieldContext) {
    throw new Error('useFormField should be used within <FormField>')
  }

  if (!itemContext) {
    throw new Error('useFormField should be used within <FormItem>')
  }

  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState
  }
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue | null>(null)

const formItemVariants = cva('grid', {
  variants: {
    density: {
      default: 'gap-2',
      compact: 'gap-1'
    }
  },
  defaultVariants: {
    density: 'default'
  }
})

function FormItem({
  className,
  density = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof formItemVariants>) {
  const id = React.useId()

  return (
    <FormItemContext value={{ id }}>
      <div data-slot="form-item" className={cn(formItemVariants({ density }), className)} {...props} />
    </FormItemContext>
  )
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField()

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn('data-[error=true]:text-destructive', className)}
      htmlFor={formItemId}
      {...props}
    />
  )
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  )
}

function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { formDescriptionId } = useFormField()

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn('text-foreground-muted text-sm', className)}
      {...props}
    />
  )
}

function FormMessage({ className, ...props }: React.ComponentProps<'p'>) {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message ?? '') : props.children

  if (!body) {
    return null
  }

  return (
    <p data-slot="form-message" id={formMessageId} className={cn('text-destructive text-sm', className)} {...props}>
      {body}
    </p>
  )
}

/* -------------------------------------------------------------------------------------------------
 * FormSection
 * -----------------------------------------------------------------------------------------------*/

interface FormSectionProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  title?: React.ReactNode
  description?: React.ReactNode
  divided?: boolean
}

function FormSection({ title, description, divided = false, className, children, ...props }: FormSectionProps) {
  const hasHeader = !!title || !!description

  return (
    <section
      data-slot="form-section"
      data-divided={divided || undefined}
      className={cn(
        divided && 'border-border-muted border-t pt-5 pb-5 first:border-t-0 first:pt-0 last:pb-0',
        className
      )}
      {...props}>
      {hasHeader && (
        <header data-slot="form-section-header" className="mb-4 grid gap-1">
          {title && <h3 className="text-base font-medium">{title}</h3>}
          {description && <p className="text-foreground-muted text-sm leading-normal">{description}</p>}
        </header>
      )}
      {children}
    </section>
  )
}

/* -------------------------------------------------------------------------------------------------
 * FormGrid
 * -----------------------------------------------------------------------------------------------*/

const formGridVariants = cva('grid items-start [&>*]:min-w-0', {
  variants: {
    columns: {
      1: 'grid-cols-1',
      2: 'grid-cols-1 xl:grid-cols-2'
    },
    gap: {
      sm: 'gap-3',
      md: 'gap-4'
    }
  },
  defaultVariants: {
    columns: 2,
    gap: 'md'
  }
})

function FormGrid({
  className,
  columns,
  gap,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof formGridVariants>) {
  return <div data-slot="form-grid" className={cn(formGridVariants({ columns, gap }), className)} {...props} />
}

/* -------------------------------------------------------------------------------------------------
 * FormActions
 * -----------------------------------------------------------------------------------------------*/

const formActionsVariants = cva('flex items-center gap-2', {
  variants: {
    align: {
      end: 'justify-end',
      between: 'justify-between',
      start: 'justify-start'
    },
    bordered: {
      true: 'border-border-muted border-t pt-4',
      false: ''
    }
  },
  defaultVariants: {
    align: 'end',
    bordered: false
  }
})

function FormActions({
  className,
  align,
  bordered,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof formActionsVariants>) {
  return <div data-slot="form-actions" className={cn(formActionsVariants({ align, bordered }), className)} {...props} />
}

/* -------------------------------------------------------------------------------------------------
 * FieldHeader
 * -----------------------------------------------------------------------------------------------*/

function FieldHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-header" className={cn('flex items-center gap-1.5', className)} {...props} />
}

function FieldHeaderAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-header-action" className={cn('ml-auto', className)} {...props} />
}

/* -------------------------------------------------------------------------------------------------
 * InlineSettingField
 * -----------------------------------------------------------------------------------------------*/

interface InlineSettingFieldProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
}

function InlineSettingField({ title, description, className, children, ...props }: InlineSettingFieldProps) {
  return (
    <div
      data-slot="inline-setting-field"
      className={cn(
        'border-border-muted flex min-h-12 items-center justify-between gap-3 rounded-md border px-4 py-2',
        className
      )}
      {...props}>
      <div data-slot="inline-setting-field-text" className="grid min-w-0 gap-0.5">
        <div className="text-foreground text-sm font-medium">{title}</div>
        {description && <p className="text-foreground-muted text-sm leading-normal">{description}</p>}
      </div>
      <div data-slot="inline-setting-field-control" className="shrink-0">
        {children}
      </div>
    </div>
  )
}

export {
  FieldHeader,
  FieldHeaderAction,
  Form,
  FormActions,
  FormControl,
  FormDescription,
  FormField,
  FormGrid,
  FormItem,
  FormLabel,
  FormMessage,
  FormSection,
  InlineSettingField,
  useFormField
}
export type { FormSectionProps, InlineSettingFieldProps }
