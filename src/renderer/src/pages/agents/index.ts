import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { Agent } from '@renderer/types'
import { useEffect, useState } from 'react'
import store from '@renderer/store'

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
  const { agentssubscribeUrl } = store.getState().settings

  useEffect(() => {
    const loadAgents = async () => {
      try {
        // 检查是否使用远程数据源
        if (agentssubscribeUrl && agentssubscribeUrl.startsWith('http')) {
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            const response = await fetch(agentssubscribeUrl);
            if (!response.ok) {
              throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const agentsData = await response.json() as Agent[];
            setAgents(agentsData);
            return;
          } catch (error) {
            console.error("Failed to load remote agents:", error);
            // 远程加载失败，继续尝试加载本地数据
          }
        }
        
        // 如果没有远程配置或获取失败，加载本地代理
        if (resourcesPath && _agents.length === 0) {
          const localAgentsData = await window.api.fs.read(resourcesPath + '/data/agents.json')
          _agents = JSON.parse(localAgentsData) as Agent[]
        }
        
        setAgents(_agents)
      } catch (error) {
        console.error('Failed to load agents:', error)
        // 发生错误时使用已加载的本地 agents
        setAgents(_agents)
      }
    }

    loadAgents()
  }, [defaultAgent, resourcesPath, agentssubscribeUrl])

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
