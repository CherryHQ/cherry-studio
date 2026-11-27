import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import { createRoot } from 'react-dom/client'

import { LegacyUpgradeChannels, type LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

import LegacyUpgradeApp from './LegacyUpgradeApp'

const screen: LegacyUpgradeScreen = await window.electron.ipcRenderer.invoke(LegacyUpgradeChannels.GetScreen)
document.documentElement.classList.toggle('dark', screen.dark)
createRoot(document.getElementById('root')!).render(<LegacyUpgradeApp screen={screen} />)
