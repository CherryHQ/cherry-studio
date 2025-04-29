import { FC } from 'react'
import { Route, Routes } from 'react-router-dom'

import AihubmixPage from './AihubmixPage'
import SiliconPage from './PaintingsPage'

const Options = ['aihubmix', 'silicon']

const PaintingsRoutePage: FC = () => {
  return (
    <Routes>
      <Route path="/" element={<AihubmixPage Options={Options} />} />
      <Route path="/aihubmix" element={<AihubmixPage Options={Options} />} />
      <Route path="/silicon" element={<SiliconPage Options={Options} />} />
    </Routes>
  )
}

export default PaintingsRoutePage
