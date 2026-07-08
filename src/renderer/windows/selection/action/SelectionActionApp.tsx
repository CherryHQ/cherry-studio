import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import type { FC } from 'react'

import ActionWindow from './ActionWindow'

// <ToastHost/> renders the toast viewport with the current language's labels — this
// window previously used a label-less ToastProvider that always showed English.
const SelectionActionApp: FC = () => {
  return (
    <ThemeProvider>
      <CodeStyleProvider>
        <ActionWindow />
        <PopupHost />
        <ToastHost />
      </CodeStyleProvider>
    </ThemeProvider>
  )
}

export default SelectionActionApp
