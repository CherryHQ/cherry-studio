import { useRuntime } from '@renderer/hooks/useRuntime'
import { Agent } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { useEffect, useState } from 'react'

let _agents: Agent[] = []

export const getAgentsFromSystemAgents = (systemAgents: any) => {
  const agents: Agent[] = []
  for (let i = 0; i < systemAgents.length; i++) {
    for (let j = 0; j < systemAgents[i].group.length; j++) {
      const agent = { ...systemAgents[i], group: systemAgents[i].group[j], topics: [], type: 'agent' } as Agent
      agents.push(agent)
    }
  }
  return agents
}

export function useSystemAgents() {
  const [agents, setAgents] = useState<Agent[]>(_agents)
  const { resourcesPath } = useRuntime()

  useEffect(() => {
    runAsyncFunction(async () => {
      if (!resourcesPath || _agents.length > 0) return
      const agents = await window.api.fs.read(resourcesPath + '/data/agents.json')
      _agents = JSON.parse(agents) as Agent[]
      setAgents(_agents)
    })
  }, [resourcesPath])

  return agents
}

export function groupByCategories(data: Agent[]) {
  const groupedMap = new Map<string, Agent[]>()
  data.forEach((item) => {
    item.group?.forEach((category) => {
      if (!groupedMap.has(category)) {
        groupedMap.set(category, [])
      }
      groupedMap.get(category)?.push(item)
    })
  })
  const result: Record<string, Agent[]> = {}
  Array.from(groupedMap.entries()).forEach(([category, items]) => {
    result[category] = items
  })
  return result
}
