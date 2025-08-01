import React, { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { ROUTERS } from '../routers'

const DiscoverContent: React.FC = () => {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route index element={<Navigate to="assistant" replace />} />
        {ROUTERS.map((route) => (
          <Route key={route.id} path={route.path} element={<route.component />} />
        ))}
      </Routes>
    </Suspense>
  )
}

export default DiscoverContent
