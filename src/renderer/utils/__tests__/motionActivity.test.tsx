import { act, render } from '@testing-library/react'
import { AnimatePresence, motion } from 'motion/react'
import { Activity } from 'react'
import { expect, it } from 'vitest'

it('does not replay blocked initial keyframes when a tab reconnects', async () => {
  const Content = ({ visible }: { visible: boolean }) => (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <AnimatePresence initial={false}>
        <motion.div animate={{ opacity: [0, 1] }} transition={{ duration: 1 }}>
          Content
        </motion.div>
      </AnimatePresence>
    </Activity>
  )
  const { getByText, rerender } = render(<Content visible />)
  const content = getByText('Content')
  expect(content.style.opacity).toBe('1')

  rerender(<Content visible={false} />)
  rerender(<Content visible />)
  await act(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  expect(content.style.opacity).toBe('1')
})
