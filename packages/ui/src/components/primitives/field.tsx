import { cn } from '@cherrystudio/ui/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

/* -----------------------------------------------------------------------------
 * Field
 * -------------------------------------------------------------------------- */

const fieldVariants = cva('grid gap-2', {
  variants: {
    orientation: {
      vertical: 'grid-cols-1',
      horizontal: 'grid-cols-[1fr_auto] items-center'
    }
  },
  defaultVariants: {
    orientation: 'vertical'
  }
})

interface FieldProps extends React.ComponentProps<'div'>, VariantProps<typeof fieldVariants> {}

function Field({ className, orientation, ...props }: FieldProps) {
  return (
    <div
      data-slot="field"
      className={cn(
        fieldVariants({ orientation }),
        'data-[invalid=true]:text-destructive [&_[data-slot=field-label]]:data-[invalid=true]:text-destructive',
        className
      )}
      {...props}
    />
  )
}

/* -----------------------------------------------------------------------------
 * FieldLabel
 * -------------------------------------------------------------------------- */

interface FieldLabelProps extends React.ComponentProps<'label'> {
  asChild?: boolean
}

function FieldLabel({ className, asChild, ...props }: FieldLabelProps) {
  const Comp = asChild ? Slot : 'label'
  return (
    <Comp
      data-slot="field-label"
      className={cn(
        'flex items-center gap-2 font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className
      )}
      {...props}
    />
  )
}

/* -----------------------------------------------------------------------------
 * FieldDescription
 * -------------------------------------------------------------------------- */

interface FieldDescriptionProps extends React.ComponentProps<'p'> {}

function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return <p data-slot="field-description" className={cn('text-muted-foreground text-sm', className)} {...props} />
}

/* -----------------------------------------------------------------------------
 * FieldError
 * -------------------------------------------------------------------------- */

interface FieldErrorProps extends Omit<React.ComponentProps<'p'>, 'children'> {
  errors?: Array<string | { message?: string } | undefined | null>
}

function FieldError({ className, errors, ...props }: FieldErrorProps) {
  const errorMessages = errors
    ?.map((error) => {
      if (typeof error === 'string') return error
      if (error && typeof error === 'object' && 'message' in error) return error.message
      return null
    })
    .filter(Boolean)

  if (!errorMessages || errorMessages.length === 0) {
    return null
  }

  return (
    <p data-slot="field-error" className={cn('text-destructive text-sm', className)} {...props}>
      {errorMessages.join(', ')}
    </p>
  )
}

/* -----------------------------------------------------------------------------
 * FieldContent - For horizontal layout content grouping
 * -------------------------------------------------------------------------- */

interface FieldContentProps extends React.ComponentProps<'div'> {}

function FieldContent({ className, ...props }: FieldContentProps) {
  return <div data-slot="field-content" className={cn('flex flex-col gap-1', className)} {...props} />
}

/* -----------------------------------------------------------------------------
 * FieldTitle - For choice cards or rich field content
 * -------------------------------------------------------------------------- */

interface FieldTitleProps extends React.ComponentProps<'span'> {}

function FieldTitle({ className, ...props }: FieldTitleProps) {
  return <span data-slot="field-title" className={cn('font-medium text-sm leading-none', className)} {...props} />
}

/* -----------------------------------------------------------------------------
 * FieldGroup - Groups multiple fields together
 * -------------------------------------------------------------------------- */

interface FieldGroupProps extends React.ComponentProps<'div'> {}

function FieldGroup({ className, ...props }: FieldGroupProps) {
  return <div data-slot="field-group" className={cn('flex flex-col gap-4', className)} {...props} />
}

/* -----------------------------------------------------------------------------
 * FieldSet - Semantic fieldset wrapper
 * -------------------------------------------------------------------------- */

interface FieldSetProps extends React.ComponentProps<'fieldset'> {}

function FieldSet({ className, ...props }: FieldSetProps) {
  return (
    <fieldset data-slot="field-set" className={cn('flex flex-col gap-4 border-none p-0 m-0', className)} {...props} />
  )
}

/* -----------------------------------------------------------------------------
 * FieldLegend - Legend for fieldset
 * -------------------------------------------------------------------------- */

interface FieldLegendProps extends React.ComponentProps<'legend'> {}

function FieldLegend({ className, ...props }: FieldLegendProps) {
  return <legend data-slot="field-legend" className={cn('font-semibold text-base', className)} {...props} />
}

/* -----------------------------------------------------------------------------
 * FieldSeparator - Visual separator between fields
 * -------------------------------------------------------------------------- */

interface FieldSeparatorProps extends React.ComponentProps<'div'> {}

function FieldSeparator({ className, ...props }: FieldSeparatorProps) {
  return <div data-slot="field-separator" className={cn('bg-border h-px w-full', className)} {...props} />
}

export {
  Field,
  FieldContent,
  type FieldContentProps,
  FieldDescription,
  type FieldDescriptionProps,
  FieldError,
  type FieldErrorProps,
  FieldGroup,
  type FieldGroupProps,
  FieldLabel,
  type FieldLabelProps,
  FieldLegend,
  type FieldLegendProps,
  type FieldProps,
  FieldSeparator,
  type FieldSeparatorProps,
  FieldSet,
  type FieldSetProps,
  FieldTitle,
  type FieldTitleProps
}
