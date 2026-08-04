// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { Form, FormField, FormItem, FormLabel } from '@cherrystudio/ui/components/composites/form'
import { Label, RequiredMark } from '@cherrystudio/ui/components/primitives/label'
import { cleanup, render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

describe('RequiredMark', () => {
  it('renders a destructive asterisk', () => {
    render(<RequiredMark data-testid="mark" />)
    const mark = screen.getByTestId('mark')
    expect(mark).toHaveTextContent('*')
    expect(mark).toHaveClass('text-destructive')
  })
})

describe('Label required', () => {
  it('renders the required asterisk when required', () => {
    render(<Label required>Provider Name</Label>)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('omits the asterisk by default', () => {
    render(<Label>Provider Name</Label>)
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  it('does not leak the required flag onto the label DOM node', () => {
    render(
      <Label required data-testid="lbl">
        Provider Name
      </Label>
    )
    expect(screen.getByTestId('lbl')).not.toHaveAttribute('required')
  })
})

describe('FormLabel forwards required', () => {
  function Harness({ required }: { required?: boolean }) {
    const form = useForm({ defaultValues: { name: '' } })
    return (
      <Form {...form}>
        <FormField
          control={form.control}
          name="name"
          render={() => (
            <FormItem>
              <FormLabel required={required}>Name</FormLabel>
            </FormItem>
          )}
        />
      </Form>
    )
  }

  it('renders the asterisk when required is passed through FormLabel', () => {
    render(<Harness required />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('omits the asterisk when not required', () => {
    render(<Harness />)
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })
})
