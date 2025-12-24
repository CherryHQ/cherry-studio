import PaintingsRoutePage from '@renderer/pages/paintings/PaintingsRoutePage'
import { createFileRoute } from '@tanstack/react-router'

// 通配符路由：捕获 /paintings/* 所有子路径
export const Route = createFileRoute('/paintings/$')({
  component: PaintingsRoutePage
})
