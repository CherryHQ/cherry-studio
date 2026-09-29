import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

import { application } from '@application'

export const CONNECTION_CHECK_TOOL_NAME = 'device_connection_check'
export const CONNECTION_INSTALL_TOOL_NAME = 'device_connection_install'
const empty = z.strictObject({})

export class CherryConnectionTools {
  tools(): Tool[] {
    return [
      {
        name: CONNECTION_CHECK_TOOL_NAME,
        description:
          'Read Cherry device ingress, local connection candidates and local Tailscale/ZeroTier status. Ready VPN status does not verify phone connectivity. No pairing secrets, VPN credentials or peer lists are returned.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      },
      {
        name: CONNECTION_INSTALL_TOOL_NAME,
        description:
          'Help install the official Tailscale desktop client after user approval. Reuses an existing installation. Uses bundled mise system packages on supported macOS; returns manual-required and the official download page if system authorization or manual installation is needed. The user must complete system permissions, official login and phone setup. Never reports phone connectivity.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      }
    ]
  }

  handles(name: string) {
    return name === CONNECTION_CHECK_TOOL_NAME || name === CONNECTION_INSTALL_TOOL_NAME
  }

  async call(name: string, args: unknown): Promise<CallToolResult> {
    try {
      empty.parse(args ?? {})
      const service = application.get('RemoteAccessService')
      let result: unknown
      if (name === CONNECTION_INSTALL_TOOL_NAME) {
        result = {
          ...(await service.installTailscale()),
          downloadUrl: 'https://tailscale.com/download',
          phoneVerified: false
        }
      } else if (name === CONNECTION_CHECK_TOOL_NAME) {
        const gateway = application.get('ApiGatewayService')
        const config = gateway.getCurrentConfig()
        const enabled = config.enabled && gateway.isRunning() && config.host === '0.0.0.0'
        result = {
          enabled,
          endpoint: enabled ? gateway.getRemoteEndpoint() : null,
          networks: await service.checkNetworks(),
          phoneVerified: false
        }
      } else throw new Error('Unknown connection tool')
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch {
      return {
        isError: true,
        content: [
          { type: 'text', text: 'Connection setup could not complete. Check Device Connections settings and retry.' }
        ]
      }
    }
  }
}
