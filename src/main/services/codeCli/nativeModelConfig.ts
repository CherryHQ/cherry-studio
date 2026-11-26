import { claudeModelProfile } from '@cherrystudio/agent-runtime-claude-code/cli'
import { readModelProfile, updateModelProfile } from '@main/ai/runtime/cli/cliModelProfile'
import { t } from '@main/i18n'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { acpModelProfile } from '../../ai/runtime/acp/acpPresets'
import { codexCliBinding } from '../../ai/runtime/codex/codexLaunch'

function profileFor(target: CliConfigTarget) {
  if (target === claudeModelProfile.target) return claudeModelProfile
  if (target === codexCliBinding.profile.target) return codexCliBinding.profile
  const profile = acpModelProfile(target)
  if (!profile) throw new Error(t('code_cli.model.unsupported'))
  return profile
}

export function updateNativeModelConfig(target: CliConfigTarget, content: string | null, model?: string) {
  return updateModelProfile(profileFor(target), content, model)
}

export function readNativeModelConfig(target: CliConfigTarget, content: string) {
  return readModelProfile(profileFor(target), content)
}
