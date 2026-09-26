import agentsIcon from '@renderer/assets/images/apps/launchpad-agents.svg'
import assistantsIcon from '@renderer/assets/images/apps/launchpad-assistants.svg'
import codeToolsIcon from '@renderer/assets/images/apps/launchpad-code-tools.svg'
import dshIcon from '@renderer/assets/images/apps/launchpad-dsh.svg'
import filesIcon from '@renderer/assets/images/apps/launchpad-files.svg'
import knowledgeIcon from '@renderer/assets/images/apps/launchpad-knowledge.svg'
import miniAppIcon from '@renderer/assets/images/apps/launchpad-mini-app.svg'
import notesIcon from '@renderer/assets/images/apps/launchpad-notes.svg'
import paintingsIcon from '@renderer/assets/images/apps/launchpad-paintings.svg'
import translateIcon from '@renderer/assets/images/apps/launchpad-translate.svg'
import type { SidebarAppId } from '@renderer/utils/sidebar'

export const LAUNCHPAD_APP_ICONS: Record<SidebarAppId, string> = {
  assistants: assistantsIcon,
  agents: agentsIcon,
  paintings: paintingsIcon,
  translate: translateIcon,
  mini_app: miniAppIcon,
  knowledge: knowledgeIcon,
  files: filesIcon,
  code_tools: codeToolsIcon,
  notes: notesIcon
}

export const DEEPSEEK_HARNESS_URL = '/app/code?tool=deepseek-harness'
export const DEEPSEEK_HARNESS_ICON = dshIcon
