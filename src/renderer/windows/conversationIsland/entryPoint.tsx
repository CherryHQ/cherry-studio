import '@renderer/assets/styles/tailwind.css'

import { createRoot } from 'react-dom/client'

import ConversationIsland from './ConversationIsland'

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<ConversationIsland />)
