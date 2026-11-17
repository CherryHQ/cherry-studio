// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { ColumnDef } from '@tanstack/react-table'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { DataTable } from '../../composites/data-table'
import { Command, CommandEmpty, CommandList } from '../command'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

const markOf = (text: string) => screen.getByText(text).parentElement?.querySelector('[data-slot="empty-state-mark"]')

describe('compact empty mark', () => {
  it('puts the mark above a plain-text command-list empty message', () => {
    render(
      <Command>
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
        </CommandList>
      </Command>
    )

    expect(markOf('No results')).not.toBeNull()
  })

  it('renders a caller-provided empty node unchanged, without a second mark', () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandEmpty>
            <button type="button">Create one</button>
          </CommandEmpty>
        </CommandList>
      </Command>
    )

    expect(screen.getByRole('button', { name: 'Create one' })).toBeInTheDocument()
    expect(container.querySelector('[data-slot="empty-state-mark"]')).toBeNull()
  })

  const columns: ColumnDef<{ id: string; name: string }>[] = [{ accessorKey: 'name', header: 'Name' }]

  it('marks an empty table row that has plain-text copy', () => {
    render(<DataTable data={[]} columns={columns} rowKey="id" emptyText="No backups" />)

    expect(markOf('No backups')).not.toBeNull()
  })

  it('keeps a custom empty node in a table as the caller wrote it', () => {
    const { container } = render(
      <DataTable data={[]} columns={columns} rowKey="id" emptyText={<p>Nothing to show yet</p>} />
    )

    expect(screen.getByText('Nothing to show yet')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="empty-state-mark"]')).toBeNull()
  })
})
