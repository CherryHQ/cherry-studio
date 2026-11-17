// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { ColumnDef } from '@tanstack/react-table'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../primitives/checkbox', () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
    ...props
  }: React.ComponentProps<'button'> & {
    checked?: boolean | 'indeterminate'
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'indeterminate' ? 'mixed' : Boolean(checked)}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  )
}))

vi.mock('../../../primitives/radio-group', async () => {
  const React = await import('react')
  const RadioContext = React.createContext<{
    value?: string
    onValueChange?: (value: string) => void
  }>({})

  return {
    RadioGroup: ({
      value,
      onValueChange,
      children,
      ...props
    }: React.ComponentProps<'div'> & {
      value?: string
      onValueChange?: (value: string) => void
    }) => (
      <RadioContext value={{ value, onValueChange }}>
        <div role="radiogroup" {...props}>
          {children}
        </div>
      </RadioContext>
    ),
    RadioGroupItem: ({
      value,
      disabled,
      ...props
    }: Omit<React.ComponentProps<'button'>, 'value'> & {
      value: string
    }) => {
      const context = React.use(RadioContext)

      return (
        <button
          type="button"
          role="radio"
          aria-checked={context.value === value}
          disabled={disabled}
          onClick={() => context.onValueChange?.(value)}
          {...props}
        />
      )
    }
  }
})

import { DataTable } from '../index'

type Person = {
  id: string
  name: string
  role: string
  locked?: boolean
}

const people: Person[] = [
  { id: '1', name: 'Ada', role: 'Engineer' },
  { id: '2', name: 'Grace', role: 'Scientist' },
  { id: '3', name: 'Linus', role: 'Maintainer', locked: true }
]

const columns: ColumnDef<Person>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    meta: { width: 180, maxWidth: 180 }
  },
  {
    accessorKey: 'role',
    header: 'Role',
    cell: ({ row }) => <span>{row.original.role}</span>
  }
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DataTable', () => {
  it('renders dynamic columns and cells', () => {
    render(<DataTable data={people} columns={columns} rowKey="id" />)

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument()
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Scientist')).toBeInTheDocument()
  })

  it('applies explicit column widths and leaves unspecified columns fluid', () => {
    render(<DataTable data={people} columns={columns} rowKey="id" />)

    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveStyle({ width: '180px' })
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveStyle({ maxWidth: '180px' })
    expect(screen.getByRole('cell', { name: 'Ada' })).toHaveStyle({ width: '180px' })
    expect(screen.getByRole('cell', { name: 'Ada' })).toHaveStyle({ maxWidth: '180px' })
    expect(screen.getByRole('columnheader', { name: 'Role' })).not.toHaveStyle({ width: '180px' })
    expect(screen.getByRole('columnheader', { name: 'Role' }).style.width).toBe('')
  })

  it('supports multiple row selection and disabled rows', () => {
    const onChange = vi.fn()

    render(
      <DataTable
        data={people}
        columns={columns}
        rowKey="id"
        selection={{
          type: 'multiple',
          selectedRowKeys: ['1'],
          onChange,
          getCheckboxProps: (person) => ({ disabled: person.locked })
        }}
      />
    )

    const graceRow = screen.getByText('Grace').closest('tr')
    expect(graceRow).not.toBeNull()
    fireEvent.click(within(graceRow as HTMLTableRowElement).getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(['1', '2'], [people[0], people[1]])

    const lockedRow = screen.getByText('Linus').closest('tr')
    expect(lockedRow).not.toBeNull()
    expect(within(lockedRow as HTMLTableRowElement).getByRole('checkbox')).toBeDisabled()
  })

  it('supports select all for multiple selection', () => {
    const onChange = vi.fn()

    render(
      <DataTable
        data={people}
        columns={columns}
        rowKey="id"
        selection={{
          type: 'multiple',
          selectedRowKeys: [],
          onChange,
          getCheckboxProps: (person) => ({ disabled: person.locked })
        }}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(onChange).toHaveBeenCalledWith(['1', '2'], [people[0], people[1]])
  })

  it('supports single row selection', () => {
    const onChange = vi.fn()

    render(
      <DataTable
        data={people}
        columns={columns}
        rowKey="id"
        selection={{
          type: 'single',
          selectedRowKey: null,
          onChange
        }}
      />
    )

    const graceRow = screen.getByText('Grace').closest('tr')
    expect(graceRow).not.toBeNull()
    fireEvent.click(within(graceRow as HTMLTableRowElement).getByRole('radio'))
    expect(onChange).toHaveBeenCalledWith('2', people[1])
  })

  it('tracks one selected row for single selection', () => {
    render(
      <DataTable
        data={people}
        columns={columns}
        rowKey="id"
        selection={{
          type: 'single',
          selectedRowKey: '1',
          onChange: vi.fn()
        }}
      />
    )

    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    expect(radios[1]).toHaveAttribute('aria-checked', 'false')
  })

  it('renders empty text', () => {
    render(<DataTable data={[]} columns={columns} rowKey="id" emptyText="No people" />)
    expect(screen.getByText('No people')).toBeInTheDocument()
  })

  it('supports controlled expanded rows', () => {
    const onExpandedRowChange = vi.fn()

    render(
      <DataTable
        data={people}
        columns={columns}
        rowKey="id"
        expandedRowKeys={['1']}
        onExpandedRowChange={onExpandedRowChange}
        renderExpandedRow={(person) => <div>Details for {person.name}</div>}
      />
    )

    expect(screen.getByText('Details for Ada')).toBeInTheDocument()

    const graceRow = screen.getByText('Grace').closest('tr')
    expect(graceRow).not.toBeNull()
    fireEvent.click(within(graceRow as HTMLTableRowElement).getByRole('button', { name: 'Expand row' }))
    expect(onExpandedRowChange).toHaveBeenCalledWith(['1', '2'])
  })
})
