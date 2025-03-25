import { useRuntime } from '@renderer/hooks/useRuntime'
import { Agent } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
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
  const { defaultaides } = store.getState().settings
  if (defaultaides === null || defaultaides === undefined) {
    console.error('defaultaides is null or undefined');
    return useLocalSystemAgents();
  }
  if (!defaultaides.startsWith('http')) {
    return useLocalSystemAgents();
  } else {
    return useRemoteSystemAgents();
  }
}

const useRemoteSystemAgents = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const { defaultaides } = store.getState().settings
  const resourcesPath = `${defaultaides}`;
  if (defaultaides === null || defaultaides === undefined) {
    console.error('defaultaides is null or undefined');
    return agents;
  }
  useEffect(() => {
    const loadAgents = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const response = await fetch(resourcesPath);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const agentsData = await response.json() as Agent[];
        setAgents(agentsData);
      } catch (error) {
        console.error("Failed to load agents:", error);
      }
    };

    loadAgents();
  }, [resourcesPath]);

  return agents;
};

const useLocalSystemAgents = () => {
  const [agents, setAgents] = useState<Agent[]>(_agents);
  const { resourcesPath } = useRuntime();

  useEffect(() => {
    runAsyncFunction(async () => {
      if (_agents.length > 0) return;
      const agents = await window.api.fs.read(resourcesPath + '/data/agents.json');
      _agents = JSON.parse(agents) as Agent[];
      setAgents(_agents);
    });
  }, [resourcesPath]);

  return agents;
};

