import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import { AgentWebUiControl } from '../AgentWebUiControl'

vi.unmock('@cherrystudio/ui')

function WebUiHarness({ external = false }: { external?: boolean }) {
  const [running, setRunning] = useState(external)
  const [opens, setOpens] = useState(0)
  return (
    <>
      <AgentWebUiControl
        running={running}
        disabled={false}
        pending={false}
        onStart={() => setRunning(true)}
        onStop={external ? undefined : () => setRunning(false)}
        onOpen={() => setOpens((count) => count + 1)}
      />
      <output aria-label="opened views">{opens}</output>
    </>
  )
}

it('toggles service lifetime from one icon button without opening WebUI implicitly', async () => {
  const user = userEvent.setup()
  render(<WebUiHarness />)
  const start = screen.getByRole('button', { name: '启动服务' })
  expect(start.textContent).toBe('')
  await user.click(start)
  expect(screen.getByRole('status', { name: 'opened views' })).toHaveTextContent('0')
  expect(screen.getByRole('button', { name: '停止服务' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '打开 WebUI' }))
  expect(screen.getByRole('status', { name: 'opened views' })).toHaveTextContent('1')
  await user.click(screen.getByRole('button', { name: '停止服务' }))
  expect(screen.getByRole('button', { name: '启动服务' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '打开 WebUI' })).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'opened views' })).toHaveTextContent('1')
})

it('allows opening an externally owned service without offering to stop it', async () => {
  const user = userEvent.setup()
  render(<WebUiHarness external />)
  expect(screen.queryByRole('button', { name: '停止服务' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '打开 WebUI' }))
  expect(screen.getByRole('status', { name: 'opened views' })).toHaveTextContent('1')
  expect(screen.getByRole('button', { name: '打开 WebUI' })).toBeEnabled()
})
