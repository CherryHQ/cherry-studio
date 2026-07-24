import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '../pagination'

describe('Pagination', () => {
  it('renders localized navigation labels supplied by the consumer', () => {
    render(
      <Pagination aria-label="任务分页">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="#" aria-label="上一页">
              上一页
            </PaginationPrevious>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="#" aria-label="下一页">
              下一页
            </PaginationNext>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    )

    expect(screen.getByRole('navigation', { name: '任务分页' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '上一页' })).toHaveTextContent('上一页')
    expect(screen.getByRole('link', { name: '下一页' })).toHaveTextContent('下一页')
  })
})
