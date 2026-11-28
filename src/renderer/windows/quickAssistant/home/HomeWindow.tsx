import QuickAssistantView from '@renderer/components/quickAssistant/home/QuickAssistantView'
import { ipcApi } from '@renderer/ipc'

const windowControls = {
  setPinned: (isPinned: boolean) => {
    void ipcApi.request('quick_assistant.set_pin', { isPinned })
  },
  hide: () => {
    void ipcApi.request('quick_assistant.hide')
  },
  subscribeShown: (onShown: () => void) => ipcApi.on('quick_assistant.shown', onShown)
}

export default function HomeWindow() {
  return <QuickAssistantView windowControls={windowControls} draggable />
}
