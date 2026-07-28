import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submit: vi.fn().mockResolvedValue({}),
  refetch: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Skeleton: () => <div data-testid="skeleton" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: () => ({
    data: {
      items: [
        {
          cardId: '01984f16-086b-7df0-b9d4-a443d7603888',
          direction: 'production',
          unit: {
            id: '01984f16-086b-7df0-b9d4-a443d7603889',
            kind: 'sentence',
            english: 'I would like a cup of tea.',
            meaning: '我想要一杯茶。',
            usageNote: null
          }
        }
      ]
    },
    isLoading: false,
    refetch: mocks.refetch
  }),
  useMutation: () => ({ trigger: mocks.submit, isLoading: false })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

import { ReviewPage } from '../ReviewPage'

afterEach(() => {
  cleanup()
  mocks.submit.mockClear()
  mocks.refetch.mockClear()
})

describe('ReviewPage', () => {
  it('reveals the answer and submits an FSRS rating', async () => {
    render(<ReviewPage />)

    expect(screen.getByText('我想要一杯茶。')).toBeInTheDocument()
    expect(screen.queryByText('I would like a cup of tea.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('english_learning.review.show_answer'))
    expect(screen.getByText('I would like a cup of tea.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('english_learning.review.rating.good'))

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        body: expect.objectContaining({
          cardId: '01984f16-086b-7df0-b9d4-a443d7603888',
          rating: 'good'
        })
      })
    )
    expect(mocks.refetch).toHaveBeenCalled()
  })
})
