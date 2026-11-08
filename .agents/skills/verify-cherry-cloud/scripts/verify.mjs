import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const groups = [
  ['node', ['.agents/skills/verify-cherry-cloud/scripts/contracts.mjs']],
  ['node', ['.agents/skills/verify-cherry-cloud/scripts/ownership.mjs']],
  [
    'pnpm',
    [
      'test:main',
      'src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts',
      'src/main/services/cherryCloud/__tests__/CherryCloudNotificationService.test.ts',
      'src/main/services/cherryCloud/__tests__/CherryCloudLoopbackCallback.test.ts',
      'src/main/services/cherryCloud/__tests__/contracts.test.ts',
      'src/main/services/cherryCloud/__tests__/crypto.test.ts',
      'src/main/ipc/handlers/__tests__/cherryCloud.test.ts',
      'src/main/services/__tests__/AnalyticsService.test.ts',
      'src/main/services/cherryCloud/__tests__/subscriptionAnalytics.test.ts',
      'src/main/ai/provider/__tests__/cherryCloud.test.ts',
      'src/main/ai/runtime/claudeCode/__tests__/ClaudeMessageMetadata.test.ts'
    ]
  ],
  [
    'pnpm',
    [
      'test:renderer',
      'src/renderer/services/__tests__/CherryCloudSubscriptionService.exhaustive.test.ts',
      'src/renderer/utils/__tests__/cherryCloudTargetAdvice.exhaustive.test.ts',
      'src/renderer/services/__tests__/cherryCloudSubscription.test.ts',
      'src/renderer/services/__tests__/cherryCloudAccountPortal.test.ts',
      'src/renderer/services/__tests__/cherryCloudSubscriptionAnalytics.test.ts',
      'src/renderer/components/__tests__/UserAccountPanel.test.tsx',
      'src/renderer/pages/settings/__tests__/SubscriptionSettings.test.tsx',
      'src/renderer/hooks/__tests__/useCherryAccountSession.test.ts',
      'src/renderer/hooks/__tests__/useCherryCloudReceipt.test.ts',
      'src/renderer/hooks/__tests__/useCherryCloudModelAvailability.test.ts',
      'src/renderer/hooks/__tests__/useCherryCloudQuotaExhaustion.test.tsx',
      'src/renderer/windows/main/hooks/__tests__/useCherryCloudSubscriptionReminder.test.tsx',
      'src/renderer/components/composer/__tests__/useFollowupQueue.test.ts',
      'src/renderer/components/composer/__tests__/followupCompletion.test.tsx',
      'src/renderer/components/composer/__tests__/followupQueueCache.test.tsx',
      'src/renderer/components/composer/variants/__tests__/ChatComposer.test.tsx',
      'src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx',
      'src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx',
      'src/renderer/services/__tests__/toast.test.ts',
      'src/renderer/utils/__tests__/errorClassifier.test.ts',
      'src/renderer/components/ModelSelector/__tests__/ModelSelector.test.tsx',
      'src/renderer/components/ModelSelector/__tests__/useModelSelectorData.test.ts',
      'src/renderer/components/ModelSelector/__tests__/useModelListKeyboardNav.test.ts',
      'src/renderer/components/cherryCloud/__tests__/useCherryCloudModelSelectorData.test.ts',
      'src/renderer/components/cherryCloud/__tests__/CherryCloudModelSelector.test.tsx',
      'src/renderer/components/composer/__tests__/CherryCloudQuotaNotice.test.tsx'
    ]
  ],
  [
    'pnpm',
    [
      'test:agent-runtime-claude-code',
      'packages/agent-runtime-claude-code/tests/projection.test.ts',
      'packages/agent-runtime-claude-code/tests/observation.test.ts',
      'packages/agent-runtime-claude-code/tests/runtime.test.ts'
    ]
  ]
]
if (process.argv.length !== 2) throw new Error('This command accepts no arguments; its test scope is explicit.')
for (const [command, args] of groups) {
  for (const file of args.filter((arg) => /\.test\.tsx?$/.test(arg))) {
    if (!existsSync(resolve(root, file))) throw new Error(`Missing verification target: ${file}`)
  }
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
