import '@renderer/assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import { createRoot } from 'react-dom/client'

import MiniWindowApp from './MiniWindowApp'

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<MiniWindowApp />)
