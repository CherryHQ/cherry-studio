import type { Document } from 'yaml'

import { acpConfigRecord, type AcpYamlModelProfile } from '@cherrystudio/agent-runtime-acp/profile'

import { poolsideCli, poolsideEnvironmentKeys as keys } from './cli'

const gatewayServer = 'cherry-poolside'
const nativeServer = 'Poolside'
const activeServerPath = ['pool', 'default_agent_server']
const serverPath = ['agent_servers', gatewayServer]
const nativeCommand = { type: 'custom', command: poolsideCli.executable, args: poolsideCli.args }

function modelPath(server: string) {
  return ['agent_servers', server, 'default_config_options', 'model']
}

function selectedServer(doc: Document) {
  return doc.getIn(activeServerPath) === gatewayServer ? gatewayServer : nativeServer
}

export function writePoolsideGateway(doc: Document, apiKey: string, baseUrl: string, model: string) {
  doc.setIn(serverPath, {
    ...nativeCommand,
    env: { [keys.apiKey]: apiKey, [keys.baseUrl]: baseUrl, [keys.model]: model },
    default_config_options: { model }
  })
  doc.setIn(activeServerPath, gatewayServer)
}

export function clearPoolsideGateway(doc: Document) {
  if (!doc.hasIn(serverPath)) return false
  doc.deleteIn(serverPath)
  if (selectedServer(doc) === gatewayServer) doc.deleteIn(activeServerPath)
  return true
}

export function readPoolsideGateway(doc: Record<string, unknown>) {
  if (acpConfigRecord(doc.pool)?.default_agent_server !== gatewayServer) return
  const server = acpConfigRecord(acpConfigRecord(doc.agent_servers)?.[gatewayServer])
  if (!server) return
  const env = acpConfigRecord(server.env)
  return {
    apiKey: env?.[keys.apiKey],
    baseUrl: env?.[keys.baseUrl],
    model: acpConfigRecord(server.default_config_options)?.model,
    wireModel: env?.[keys.model]
  }
}

const profile = {
  format: 'yaml',
  target: poolsideCli.modelConfig.target,
  path: {
    read: (doc) => modelPath(selectedServer(doc)),
    write(doc) {
      doc.setIn(activeServerPath, nativeServer)
      if (!doc.hasIn(['agent_servers', nativeServer]))
        doc.setIn(['agent_servers', nativeServer], doc.createNode(nativeCommand))
      return modelPath(nativeServer)
    }
  },
  launch(doc, env, purpose, invalidConfig) {
    if (doc.errors.length) return invalidConfig()
    const server = purpose === 'models' ? nativeServer : selectedServer(doc)
    if (server === gatewayServer) {
      for (const key of Object.values(keys)) {
        const value = doc.getIn([...serverPath, 'env', key])
        if (typeof value !== 'string' || !value) return invalidConfig()
        env[key] = value
      }
    }
    const model = doc.getIn(modelPath(server))
    return typeof model === 'string' ? model : undefined
  }
} satisfies AcpYamlModelProfile

export const poolsidePreset = {
  id: poolsideCli.id,
  profile,
  automationName(name: string) {
    const tool = /^(?:mcp:)?poolside__agent__automation(?::|__)(js|reset)$/i.exec(name)?.[1]
    return tool ? 'mcp__automation__' + tool : undefined
  }
}
