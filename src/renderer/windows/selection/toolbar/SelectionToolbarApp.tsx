import { ThemeProvider } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'

import SelectionToolbar from './SelectionToolbar'

const SelectionToolbarApp: FC = () => {
  return (
    <ThemeProvider>
      <SelectionToolbar />
    </ThemeProvider>
  )
}

export default SelectionToolbarApp
