// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, describe, expect, it } from 'vitest'

import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '../index'

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

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(description.id)
    expect(input.getAttribute('aria-describedby')).toContain(message.id)
  })
})
