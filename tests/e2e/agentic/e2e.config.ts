import { readFileSync } from 'node:fs'

import { web } from '@e2e-dev/web'
import type { E2EConfig } from 'e2e'

import { agentModel, environment, secretValues } from './environment'

const record = JSON.parse(readFileSync(environment.AGENTIC_APP_RECORD!, 'utf8'))
const endpoint = () => `http://127.0.0.1:${record.cdpPort}`

export default {
  projectId: 'cherry-studio-agentic',
  tests: environment.AGENTIC_TEST_FILE ?? 'compatibility.test.ts',
  targets: [
    {
      name: 'electron',
      engine: web({
        viewport: null,
        connect: { cdpEndpoint: endpoint, reconnectEndpoint: endpoint, existingTargetId: environment.AGENTIC_TARGET_ID }
      }),
      app: { url: record.targetUrl, identity: 'cherry-studio-electron' }
    }
  ],
  agents: {
    default: {
      model: agentModel(),
      maxSteps: 20,
      maxModelCalls: 10,
      context:
        'Cherry Studio desktop. Use semantic controls, not screenshots. Launchpad opens apps. Settings has a Back button to return to Chat. Never change data except as instructed.'
    }
  },
  secrets: Object.fromEntries(secretValues.map((value, index) => [`environment${index}`, () => value])),
  workers: 1,
  retries: 0,
  timeout: 240_000,
  actionTimeout: 30_000,
  assertionTimeout: 30_000,
  trace: 'on',
  video: 'off',
  output: '.e2e/current',
  reporters: ['list', 'markdown'],
  cache: { mode: 'read-write', dir: '.e2e/cache' }
} satisfies E2EConfig
