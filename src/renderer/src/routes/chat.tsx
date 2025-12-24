import HomePage from '@renderer/pages/home/HomePage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/chat')({
  component: HomePage
})
