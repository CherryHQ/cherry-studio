// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Button } from '../button'
import { ButtonGroup } from '../button-group'

afterEach(() => {
  cleanup()
})

describe('ButtonGroup', () => {
  it('overlaps attached horizontal button seams', () => {
    render(
      <ButtonGroup>
        <Button variant="outline">Use assistant</Button>
        <Button>Default model</Button>
      </ButtonGroup>
    )

    expect(screen.getByRole('group')).toHaveClass('[&>*:not(:first-child)]:-ml-px')
  })

  it('overlaps attached vertical button seams', () => {
    render(
      <ButtonGroup orientation="vertical">
        <Button variant="outline">Use assistant</Button>
        <Button>Default model</Button>
      </ButtonGroup>
    )

    expect(screen.getByRole('group')).toHaveClass('[&>*:not(:first-child)]:-mt-px')
  })
})
