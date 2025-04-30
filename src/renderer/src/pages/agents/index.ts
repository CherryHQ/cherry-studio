import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { Agent } from '@renderer/types'
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
  const { defaultaides } = useSettings()
  const [agents, setAgents] = useState<Agent[]>([])
  const { resourcesPath } = useRuntime()

  useEffect(() => {
    const loadAgents = async () => {
      try {
        // Handle null/undefined case or non-http case - use local agents
        if (!defaultaides || !defaultaides.startsWith('http')) {
          if (!resourcesPath || _agents.length > 0) {
            setAgents(_agents)
            return
          }
          const agentsData = await window.api.fs.read(resourcesPath + '/data/agents.json')
          _agents = JSON.parse(agentsData) as Agent[]
          setAgents(_agents)
          return
        }

        // Handle remote agents
        const response = await fetch(defaultaides)
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const agentsData = await response.json()
        setAgents(agentsData)
      } catch (error) {
        console.error('Failed to load agents:', error)
        // Fallback to local agents on error
        if (resourcesPath && _agents.length === 0) {
          const agentsData = await window.api.fs.read(resourcesPath + '/data/agents.json')
          _agents = JSON.parse(agentsData) as Agent[]
        }
        setAgents(_agents)
      }
    }

    loadAgents()
  }, [defaultaides, resourcesPath])

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
