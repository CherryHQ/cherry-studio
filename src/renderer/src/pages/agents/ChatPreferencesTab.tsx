import Scrollbar from '@renderer/components/Scrollbar'
import ChatPreferenceSections from '@renderer/pages/chat-settings/ChatPreferenceSections'

const ChatPreferencesTab = () => {
  return (
    <Scrollbar className="settings-tab flex flex-1 flex-col px-3 py-2 text-xs">
      <ChatPreferenceSections />
    </Scrollbar>
  )
}

export default ChatPreferencesTab
