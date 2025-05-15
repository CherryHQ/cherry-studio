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
  const { defaultAgent } = useSettings()
  const [agents, setAgents] = useState<Agent[]>([])
  const { resourcesPath } = useRuntime()

  useEffect(() => {
    const loadAgents = async () => {
      try {
        // 始终加载本地 agents
        if (resourcesPath && _agents.length === 0) {
          const localAgentsData = await window.api.fs.read(resourcesPath + '/data/agents.json')
          _agents = JSON.parse(localAgentsData) as Agent[]
        }

        // 如果没有远程配置或获取失败，使用本地 agents
        setAgents(_agents)
      } catch (error) {
        console.error('Failed to load agents:', error)
        // 发生错误时使用本地 agents
        setAgents(_agents)
      }
    }

    loadAgents()
  }, [defaultAgent, resourcesPath])

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
