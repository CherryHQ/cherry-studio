// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Tabs workflow variant', () => {
  it('switches the active step when another trigger is clicked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <Tabs defaultValue="data" variant="workflow" onValueChange={onValueChange}>
        <TabsList>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="rag">RAG</TabsTrigger>
        </TabsList>
        <TabsContent value="data">data-content</TabsContent>
        <TabsContent value="rag">rag-content</TabsContent>
      </Tabs>
    )

    await user.click(screen.getByRole('tab', { name: 'RAG' }))

    expect(onValueChange).toHaveBeenCalledWith('rag')
    expect(screen.getByRole('tab', { name: 'RAG' })).toHaveAttribute('data-state', 'active')
  })
})
