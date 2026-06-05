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
  it('marks the active trigger with bold + underline styles', () => {
    render(
      <Tabs defaultValue="data" variant="workflow">
        <TabsList>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="rag">RAG</TabsTrigger>
          <TabsTrigger value="recall">Recall</TabsTrigger>
        </TabsList>
        <TabsContent value="data">data-content</TabsContent>
        <TabsContent value="rag">rag-content</TabsContent>
        <TabsContent value="recall">recall-content</TabsContent>
      </Tabs>
    )

    const dataTrigger = screen.getByRole('tab', { name: 'Data' })
    const ragTrigger = screen.getByRole('tab', { name: 'RAG' })

    expect(dataTrigger).toHaveAttribute('data-state', 'active')
    expect(dataTrigger.className).toContain('data-[state=active]:font-semibold')
    expect(dataTrigger.className).toContain('data-[state=active]:underline')
    expect(ragTrigger).toHaveAttribute('data-state', 'inactive')
  })

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

  it('applies the chevron separator class to every trigger after the first', () => {
    render(
      <Tabs defaultValue="data" variant="workflow">
        <TabsList>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="rag">RAG</TabsTrigger>
          <TabsTrigger value="recall">Recall</TabsTrigger>
        </TabsList>
      </Tabs>
    )

    const triggers = screen.getAllByRole('tab')

    expect(triggers[0].className).toContain("[&:not(:first-child)]:before:content-['›']")
    expect(triggers[1].className).toContain("[&:not(:first-child)]:before:content-['›']")
    expect(triggers[2].className).toContain("[&:not(:first-child)]:before:content-['›']")
  })
})
