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

it('opens a running service from the main button and stops it only through the menu', async () => {
  const user = userEvent.setup()
  render(<WebUiHarness />)
  expect(screen.queryByRole('button', { name: 'WebUI 操作' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '启动 WebUI' }))
  await user.click(screen.getByRole('button', { name: '打开 WebUI' }))
  expect(screen.getByRole('status', { name: 'opened views' })).toHaveTextContent('1')
  expect(screen.queryByRole('button', { name: '启动 WebUI' })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '停止 WebUI' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'WebUI 操作' }))
  await user.click(screen.getByRole('menuitem', { name: '停止 WebUI' }))
  expect(screen.getByRole('button', { name: '启动 WebUI' })).toBeEnabled()
})

it('allows opening an externally owned service without offering to stop it', async () => {
  const user = userEvent.setup()
  render(<WebUiHarness external />)
  expect(screen.queryByRole('button', { name: 'WebUI 操作' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '打开 WebUI' }))
  expect(screen.getByRole('status', { name: 'opened views' })).toHaveTextContent('1')
  expect(screen.getByRole('button', { name: '打开 WebUI' })).toBeEnabled()
})
