import { GatewayIcon } from '@renderer/components/icons/GatewayIcon'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import {
  Activity,
  Bell,
  CalendarClock,
  Cloud,
  Command,
  Crop,
  FileBox,
  FileCode,
  HardDrive,
  Info,
  Package,
  Palette,
  PictureInPicture2,
  Radio,
  ScanText,
  Search,
  Settings2,
  Terminal,
  TextCursorInput,
  ToolCase,
  Zap
} from 'lucide-react'
import type { ReactNode } from 'react'

interface SettingsSearchScope {
  prefixes: readonly string[]
  exactKeys?: readonly string[]
}

export interface SettingsNavigationItem {
  path: string
  labelKey: string
  icon: ReactNode
  search: SettingsSearchScope
}

export interface SettingsNavigationSection {
  labelKey?: string
  items: readonly SettingsNavigationItem[]
}

export const settingsNavigationSections = [
  {
    items: [
      {
        path: '/settings/provider',
        labelKey: 'settings.provider.title',
        icon: <Cloud />,
        search: {
          prefixes: ['settings.provider', 'settings.models', 'models', 'ovms', 'lmstudio', 'gpustack']
        }
      },
      {
        path: '/settings/model',
        labelKey: 'settings.model',
        icon: <Package />,
        search: {
          prefixes: [
            'settings.model',
            'settings.models.default_assistant_model',
            'settings.models.painting_model',
            'settings.models.quick_model',
            'settings.models.retry',
            'settings.models.topic_naming',
            'settings.models.translate_model',
            'settings.translate'
          ]
        }
      },
      {
        path: '/settings/local-models',
        labelKey: 'settings.dependencies.localModels.title',
        icon: <FileBox />,
        search: { prefixes: ['settings.dependencies.localModels'] }
      },
      {
        path: '/settings/api-gateway',
        labelKey: 'apiGateway.title',
        icon: <GatewayIcon />,
        search: { prefixes: ['apiGateway'] }
      }
    ]
  },
  {
    labelKey: 'settings.menuGroups.capabilities',
    items: [
      {
        path: '/settings/mcp',
        labelKey: 'agent.settings.toolsMcp.mcp.tab',
        icon: <McpLogo width={16} height={16} className="text-foreground" />,
        search: { prefixes: ['settings.mcp', 'agent.settings.toolsMcp.mcp'] }
      },
      {
        path: '/settings/skills',
        labelKey: 'settings.skills.title',
        icon: <ToolCase />,
        search: { prefixes: ['settings.skills'] }
      },
      {
        path: '/settings/prompts',
        labelKey: 'settings.prompts.title',
        icon: <Zap />,
        search: { prefixes: ['settings.prompts'] }
      },
      {
        path: '/settings/websearch',
        labelKey: 'settings.tool.websearch.title',
        icon: <Search />,
        search: {
          prefixes: ['settings.provider.basic_auth', 'settings.tool.websearch'],
          exactKeys: [
            'settings.general.label',
            'settings.provider.api_host',
            'settings.provider.api_key.label',
            'settings.provider.api_key.tip'
          ]
        }
      },
      {
        path: '/settings/file-processing',
        labelKey: 'settings.tool.file_processing.features.document_to_markdown.title',
        icon: <FileCode />,
        search: {
          prefixes: [
            'settings.tool.file_processing',
            'settings.tool.file_processing.features.document_to_markdown',
            'settings.tool.file_processing.processors.doc2x',
            'settings.tool.file_processing.processors.local_document',
            'settings.tool.file_processing.processors.mineru',
            'settings.tool.file_processing.processors.mistral',
            'settings.tool.file_processing.processors.open_mineru'
          ],
          exactKeys: [
            'settings.provider.api.key.list.title',
            'settings.provider.api_host',
            'settings.provider.api_key.tip',
            'settings.provider.get_api_key'
          ]
        }
      },
      {
        path: '/settings/ocr',
        labelKey: 'settings.tool.file_processing.features.image_to_text.title',
        icon: <ScanText />,
        search: {
          prefixes: [
            'settings.tool.file_processing.features.image_to_text',
            'settings.tool.file_processing.processors.local_paddleocr',
            'settings.tool.file_processing.processors.ovocr',
            'settings.tool.file_processing.processors.paddleocr',
            'settings.tool.file_processing.processors.system',
            'settings.tool.file_processing.processors.tesseract'
          ],
          exactKeys: [
            'settings.provider.api.key.list.title',
            'settings.provider.api_host',
            'settings.provider.api_key.tip',
            'settings.provider.get_api_key'
          ]
        }
      }
    ]
  },
  {
    labelKey: 'settings.menuGroups.personal',
    items: [
      {
        path: '/settings/general',
        labelKey: 'settings.general.common.title',
        icon: <Settings2 />,
        search: {
          prefixes: [
            'settings.developer',
            'settings.fetch',
            'settings.hardware_acceleration',
            'settings.launch',
            'settings.models.context_management',
            'settings.power',
            'settings.proxy',
            'settings.tray'
          ]
        }
      },
      {
        path: '/settings/appearance',
        labelKey: 'settings.appearance.title',
        icon: <Palette />,
        search: {
          prefixes: [
            'chat.settings.code_execution',
            'chat.settings.code_image_tools',
            'settings.appearance',
            'settings.display',
            'settings.general.common',
            'settings.theme',
            'settings.topic',
            'settings.use_system_title_bar',
            'settings.zoom'
          ],
          exactKeys: ['common.language']
        }
      },
      {
        path: '/settings/notifications',
        labelKey: 'settings.notification.title',
        icon: <Bell />,
        search: { prefixes: ['settings.notification'], exactKeys: ['notification.tip'] }
      },
      {
        path: '/settings/data',
        labelKey: 'settings.data.title',
        icon: <HardDrive />,
        search: { prefixes: ['settings.data', 'settings.general.backup', 'settings.privacy'] }
      },
      {
        path: '/settings/usage',
        labelKey: 'settings.usage.title',
        icon: <Activity />,
        search: { prefixes: ['settings.usage'] }
      }
    ]
  },
  {
    labelKey: 'settings.menuGroups.automation',
    items: [
      {
        path: '/settings/channels',
        labelKey: 'settings.channels.title',
        icon: <Radio />,
        search: { prefixes: ['agent.channels', 'settings.channels'] }
      },
      {
        path: '/settings/scheduled-tasks',
        labelKey: 'settings.scheduledTasks.title',
        icon: <CalendarClock />,
        search: { prefixes: ['agent.tasks', 'settings.scheduledTasks'] }
      },
      {
        path: '/settings/shortcut',
        labelKey: 'settings.shortcuts.title',
        icon: <Command />,
        search: { prefixes: ['settings.shortcuts'] }
      },
      {
        path: '/settings/quick-assistant',
        labelKey: 'settings.quickAssistant.title',
        icon: <PictureInPicture2 />,
        search: {
          prefixes: ['settings.quickAssistant', 'selection.settings.user_modal'],
          exactKeys: [
            'settings.models.quick_assistant_default_tag',
            'settings.models.quick_assistant_response_settings',
            'settings.models.quick_assistant_selection',
            'settings.models.quick_assistant_usage_method'
          ]
        }
      },
      {
        path: '/settings/selection-assistant',
        labelKey: 'selection.name',
        icon: <TextCursorInput />,
        search: { prefixes: ['selection.settings'] }
      },
      {
        path: '/settings/screenshot',
        labelKey: 'settings.screenshot.title',
        icon: <Crop />,
        search: { prefixes: ['settings.screenshot'] }
      }
    ]
  },
  {
    labelKey: 'settings.menuGroups.system',
    items: [
      {
        path: '/settings/dependencies',
        labelKey: 'settings.dependencies.title',
        icon: <Terminal />,
        search: { prefixes: ['settings.dependencies'] }
      },
      {
        path: '/settings/about',
        labelKey: 'settings.about.label',
        icon: <Info />,
        search: {
          prefixes: ['settings.about', 'settings.general.auto_check_update', 'settings.general.test_plan']
        }
      }
    ]
  }
] as const satisfies readonly SettingsNavigationSection[]

export type SettingsPath = (typeof settingsNavigationSections)[number]['items'][number]['path']
