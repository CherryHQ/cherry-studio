import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MessagePartsScopeProvider, PartsProvider, useMessagePartsScopeId } from '../MessagePartsContext'

function MessageIdProbe() {
  return <span>{useMessagePartsScopeId() ?? 'no-message'}</span>
}

describe('MessagePartsContext', () => {
  it('keeps the message ID available through a nested parts provider', () => {
    render(
      <MessagePartsScopeProvider messageId="message-1" parts={[]}>
        <PartsProvider value={{}}>
          <MessageIdProbe />
        </PartsProvider>
      </MessagePartsScopeProvider>
    )

    expect(screen.getByText('message-1')).toBeInTheDocument()
  })
})
