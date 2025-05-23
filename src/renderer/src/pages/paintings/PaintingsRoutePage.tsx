import { FC } from 'react'
import { Route, Routes } from 'react-router-dom'

import AihubmixPage from './AihubmixPage'
import DmxapiPage from './DmxapiPage'
import SiliconPage from './PaintingsPage'

const Options = ['aihubmix', 'silicon', 'dmxapi']

const PaintingsRoutePage: FC = () => {
  return (
    <Routes>
      <Route path="/" element={<AihubmixPage Options={Options} />} />
      <Route path="/aihubmix" element={<AihubmixPage Options={Options} />} />
      <Route path="/silicon" element={<SiliconPage Options={Options} />} />
      <Route path="/dmxapi" element={<DmxapiPage Options={Options} />} />
    </Routes>
  )
}

export default PaintingsRoutePage
