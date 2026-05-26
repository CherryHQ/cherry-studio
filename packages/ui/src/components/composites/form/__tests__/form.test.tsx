// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, describe, expect, it } from 'vitest'

import {
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
  InlineSettingField
} from '../index'

afterEach(() => {
  cleanup()
})

describe('Form', () => {
  it('wires aria-invalid and message ids when a field has an error', async () => {
    function FormFixture() {
      const form = useForm({ defaultValues: { name: '' } })

      useEffect(() => {
        form.setError('name', { message: 'Name is required' })
      }, [form])

      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <input {...field} />
                </FormControl>
                <FormDescription>Visible to teammates.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      )
    }

    render(<FormFixture />)

    const input = await screen.findByLabelText('Name')
    const description = screen.getByText('Visible to teammates.')
    const message = screen.getByText('Name is required')

    expect(description).toHaveClass('text-foreground-muted')
    expect(description).not.toHaveClass('text-muted-foreground')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(description.id)
    expect(input.getAttribute('aria-describedby')).toContain(message.id)
  })
})

describe('FormItem density', () => {
  it('applies compact gap when density=compact', () => {
    render(<FormItem data-testid="item" density="compact" />)
    expect(screen.getByTestId('item')).toHaveClass('gap-1')
  })

  it('applies default gap when density is omitted', () => {
    render(<FormItem data-testid="item" />)
    expect(screen.getByTestId('item')).toHaveClass('gap-2')
  })
})

describe('FormSection', () => {
  it('renders title and description when provided', () => {
    render(<FormSection title="General" description="Top-level settings" />)
    expect(screen.getByText('General')).toBeInTheDocument()
    const description = screen.getByText('Top-level settings')
    expect(description).toBeInTheDocument()
    expect(description).toHaveClass('text-foreground-muted')
    expect(description).not.toHaveClass('text-muted-foreground')
  })

  it('omits header when no title or description', () => {
    render(<FormSection data-testid="section">body</FormSection>)
    const section = screen.getByTestId('section')
    expect(section.querySelector('[data-slot="form-section-header"]')).toBeNull()
  })

  it('renders bare (no border) by default', () => {
    render(<FormSection data-testid="section" />)
    const section = screen.getByTestId('section')
    expect(section).not.toHaveClass('border-t')
    expect(section).not.toHaveAttribute('data-divided')
  })

  it('renders divider classes when divided=true', () => {
    render(<FormSection data-testid="section" divided />)
    const section = screen.getByTestId('section')
    expect(section).toHaveClass('border-t', 'border-border-muted', 'first:border-t-0', 'first:pt-0')
    expect(section).toHaveAttribute('data-divided', 'true')
  })
})

describe('FormGrid', () => {
  it('uses 2-col responsive grid by default', () => {
    render(<FormGrid data-testid="grid" />)
    const grid = screen.getByTestId('grid')
    expect(grid).toHaveClass('grid-cols-1', 'xl:grid-cols-2')
  })

  it('uses single column when columns=1', () => {
    render(<FormGrid data-testid="grid" columns={1} />)
    const grid = screen.getByTestId('grid')
    expect(grid).toHaveClass('grid-cols-1')
    expect(grid).not.toHaveClass('xl:grid-cols-2')
  })
})

describe('FormActions', () => {
  it('right-aligns and omits the top border by default', () => {
    render(<FormActions data-testid="actions" />)
    const actions = screen.getByTestId('actions')
    expect(actions).toHaveClass('justify-end')
    expect(actions).not.toHaveClass('border-t')
  })

  it('adds the top border when bordered=true', () => {
    render(<FormActions data-testid="actions" bordered />)
    const actions = screen.getByTestId('actions')
    expect(actions).toHaveClass('border-t', 'pt-4')
  })

  it('honors align=between', () => {
    render(<FormActions data-testid="actions" align="between" />)
    expect(screen.getByTestId('actions')).toHaveClass('justify-between')
  })
})

describe('FieldHeader', () => {
  it('renders children inline with gap and pushes the action slot to the right', () => {
    render(
      <FieldHeader data-testid="header">
        <span>Label</span>
        <FieldHeaderAction>
          <button type="button">edit</button>
        </FieldHeaderAction>
      </FieldHeader>
    )
    const header = screen.getByTestId('header')
    expect(header).toHaveClass('flex', 'items-center', 'gap-1.5')
    const action = header.querySelector('[data-slot="field-header-action"]')
    expect(action).not.toBeNull()
    expect(action).toHaveClass('ml-auto')
  })
})

describe('InlineSettingField', () => {
  it('renders title, description, and right-side control', () => {
    render(
      <InlineSettingField title="Enable" description="Turn on the feature">
        <input data-testid="control" type="checkbox" />
      </InlineSettingField>
    )
    expect(screen.getByText('Enable')).toBeInTheDocument()
    const description = screen.getByText('Turn on the feature')
    expect(description).toBeInTheDocument()
    expect(description).toHaveClass('text-foreground-muted')
    expect(description).not.toHaveClass('text-muted-foreground')
    expect(screen.getByTestId('control')).toBeInTheDocument()
  })

  it('omits description block when not provided', () => {
    const { container } = render(
      <InlineSettingField title="Only title">
        <input type="checkbox" />
      </InlineSettingField>
    )
    expect(container.querySelector('p')).toBeNull()
  })

  it('uses rounded-md radius and the muted semantic border', () => {
    const { container } = render(
      <InlineSettingField title="Enable">
        <input type="checkbox" />
      </InlineSettingField>
    )
    const root = container.querySelector('[data-slot="inline-setting-field"]')
    expect(root).not.toBeNull()
    expect(root).toHaveClass('rounded-md', 'border-border-muted')
    expect(root).not.toHaveClass('rounded-lg')
  })
})
