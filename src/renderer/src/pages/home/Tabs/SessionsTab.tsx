import { useRuntime } from '@renderer/hooks/useRuntime'
import { AgentSessionEntity } from '@renderer/types'
import { FC, memo } from 'react'

interface AssistantsTabProps {}

const SessionsTab: FC<AssistantsTabProps> = () => {
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const mockData: AgentSessionEntity[] = [
    {
      accessible_paths: [],
      model: '',
      id: 'test',
      agent_id: '',
      agent_type: 'claude-code',
      created_at: '',
      updated_at: ''
    }
  ]

  return (
    <div className="agents-tab h-full w-full p-2">
      {/* TODO: Add session button */}
      Active Agent ID: {activeAgentId}
      {mockData.map((session) => (
        <div key={session.id}>Not implemented</div>
      ))}
    </div>
  )
}

export default memo(SessionsTab)
