import {
  ArrowLeft,
  Archive,
  Globe,
  History,
  KeyRound,
  Plus,
  Puzzle,
  Search,
  Server,
  Smartphone,
  Laptop
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  EmptyStateScene,
  SceneBar,
  SceneButton,
  SceneChip,
  SceneGhostRow,
  SceneHeader,
  SceneInput,
  ScenePanel,
  SceneSlot,
  SceneTabs,
  SceneToggle
} from '@cherrystudio/ui'

// Empty-state scenes for the settings pages; each page draws the slice it lives in.

const PANEL = 'absolute top-[10px] left-[18px] h-[190px] w-[224px]'

/** Settings search before a match: the focused search field and a few sections to try. */
export function SettingsSearchEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={2}
      sprites={[
        { x: 232, y: 3, color: 5, shape: 'checker', tilt: 10 },
        { x: 4, y: 82, color: 7, shape: 'corner', tilt: -12 },
        { x: 240, y: 120, color: 2, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className={`${PANEL} gap-[8px] px-[12px] pt-[14px]`}>
        <SceneInput icon={Search} focused caret placeholder={t('settings.search.placeholder')} />
        <div className="flex flex-wrap gap-[5px]">
          <SceneChip label={t('settings.theme.title')} />
          <SceneChip label={t('settings.shortcuts.title')} />
          <SceneChip label={t('settings.data.title')} />
        </div>
        {[0, 1].map((index) => (
          <SceneSlot key={index} className="h-[20px] gap-[8px] px-[8px]">
            <SceneBar className="w-1/3" />
            <span className="ml-auto h-[8px] w-[14px] rounded-full border border-dashed border-border-strong" />
          </SceneSlot>
        ))}
      </ScenePanel>
    </EmptyStateScene>
  )
}

/** No browsing history: the agent browser's history list with only empty rows. */
export function BrowserHistoryEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={1}
      sprites={[
        { x: 232, y: 3, color: 6, shape: 'ring', tilt: 10 },
        { x: 4, y: 84, color: 2, shape: 'checker', tilt: -12 },
        { x: 240, y: 120, color: 1, shape: 'cross', tilt: 8 }
      ]}>
      <ScenePanel className={PANEL}>
        <SceneHeader
          icon={History}
          title={t('settings.browser.history')}
          trailing={<SceneChip accent icon={Globe} label={t('settings.browser.title')} />}
        />
        <div className="flex flex-col gap-[6px] px-[10px] pt-[10px]">
          <SceneGhostRow lead />
          <SceneGhostRow lead />
          <SceneGhostRow lead />
          <SceneGhostRow lead />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}

/** No MCP servers, prompts or resources: the server list with an accent add button and empty rows. */
export function McpEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={4}
      sprites={[
        { x: 232, y: 3, color: 1, shape: 'corner', tilt: 10 },
        { x: 4, y: 86, color: 3, shape: 'checker', tilt: -12 },
        { x: 240, y: 120, color: 4, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className={PANEL}>
        <SceneHeader
          icon={Server}
          title={t('settings.mcp.title')}
          trailing={<SceneButton accent icon={Plus} label={t('common.add')} />}
        />
        <div className="flex flex-col gap-[7px] px-[10px] pt-[10px]">
          {[0, 1, 2].map((index) => (
            <SceneSlot key={index} className="h-[26px] gap-[8px] rounded-[7px] px-[8px]">
              <span className="size-[12px] shrink-0 rounded-[4px] border border-dashed border-border-strong" />
              <SceneBar className="w-[60px]" />
              <span className="ml-auto h-[10px] w-[24px] rounded-full border border-dashed border-border-strong" />
              <SceneToggle />
            </SceneSlot>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}

/** A provider without models: its key already set, and an accent row where synced models will land. */
export function ProviderModelsEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={7}
      sprites={[
        { x: 232, y: 3, color: 2, shape: 'ring', tilt: 10 },
        { x: 4, y: 90, color: 6, shape: 'corner', tilt: -12 },
        { x: 240, y: 120, color: 7, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className={`${PANEL} gap-[7px] px-[12px] pt-[12px]`}>
        <span className="text-[6.5px] text-foreground-tertiary">{t('settings.provider.api_key.label')}</span>
        <SceneInput value="••••••••••••" />
        <span className="pt-[4px] text-[8px] font-semibold text-foreground">
          {t('settings.models.manage.drawer_title')}
        </span>
        <SceneSlot accent className="h-[20px] gap-[5px] px-[8px] text-[7.5px] font-semibold">
          <Plus size={9} strokeWidth={2.4} className="shrink-0" />
          <span className="truncate">{t('settings.models.manage.add_listed.label')}</span>
        </SceneSlot>
        <SceneGhostRow lead />
        <SceneGhostRow lead />
      </ScenePanel>
    </EmptyStateScene>
  )
}

/** No API key yet: the key field focused and waiting for input. */
export function ApiKeyEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={6}
      sprites={[
        { x: 232, y: 3, color: 3, shape: 'checker', tilt: 10 },
        { x: 4, y: 80, color: 8, shape: 'cross', tilt: -12 },
        { x: 240, y: 118, color: 6, shape: 'corner', tilt: 8 }
      ]}>
      <ScenePanel className={PANEL}>
        <SceneHeader icon={KeyRound} title={t('settings.provider.api_key.label')} trailing={<SceneToggle />} />
        <div className="flex flex-col gap-[9px] px-[12px] pt-[14px]">
          <SceneInput focused caret className="h-[22px]" />
          <div className="flex items-center">
            <SceneBar className="w-[54px]" />
            <SceneButton label={t('settings.provider.check')} className="ml-auto" />
          </div>
          <SceneSlot className="h-[22px] px-[8px]">
            <SceneBar className="w-1/2" />
          </SceneSlot>
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}

/** No usage yet: zeroed totals and a flat accent line on an empty chart. */
export function UsageEmptyScene() {
  return (
    <EmptyStateScene
      size="panel"
      accent={3}
      sprites={[
        { x: 232, y: 3, color: 8, shape: 'corner', tilt: 10 },
        { x: 4, y: 88, color: 5, shape: 'checker', tilt: -12 },
        { x: 240, y: 122, color: 3, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className={`${PANEL} gap-[10px] px-[12px] pt-[12px]`}>
        <div className="grid grid-cols-3 gap-[6px]">
          {['0', '$0.00', '0'].map((value, index) => (
            <div
              key={index}
              className="flex flex-col gap-[5px] rounded-[6px] border border-border-subtle bg-muted px-[7px] py-[6px]">
              <SceneBar className="w-2/3" />
              <span className="text-[9px] font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
        <div className="relative h-[76px]">
          <div className="absolute inset-x-0 top-[14px] border-t border-dashed border-border" />
          <div className="absolute inset-x-0 top-[40px] border-t border-dashed border-border" />
          <SceneSlot
            accent
            className="absolute inset-x-0 top-[66px] h-0 rounded-none border-0 border-t-[1.5px] border-solid bg-transparent"
          />
          <SceneSlot accent className="absolute top-[63px] right-0 size-[7px] rounded-full border-solid bg-current" />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}

/** Nothing archived: the archive tabs over empty rows. */
export function ArchiveEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={5}
      sprites={[
        { x: 232, y: 3, color: 7, shape: 'checker', tilt: 10 },
        { x: 4, y: 84, color: 1, shape: 'ring', tilt: -12 },
        { x: 240, y: 120, color: 5, shape: 'cross', tilt: 8 }
      ]}>
      <ScenePanel className={PANEL}>
        <SceneHeader icon={Archive} title={t('settings.data.trash.title')} />
        <SceneTabs
          className="border-b border-border-subtle px-[13px] pt-[8px]"
          items={[
            t('settings.data.trash.domain.topics'),
            t('settings.data.trash.domain.sessions'),
            t('settings.data.trash.domain.files')
          ]}
        />
        <div className="flex flex-col gap-[6px] px-[10px] pt-[10px]">
          <SceneGhostRow lead />
          <SceneGhostRow lead />
          <SceneGhostRow lead />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}

/** A skill that is gone: the accent way back, and the skill card struck out. */
export function SkillMissingScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={1}
      sprites={[
        { x: 232, y: 3, color: 4, shape: 'cross', tilt: 10 },
        { x: 4, y: 80, color: 6, shape: 'corner', tilt: -12 },
        { x: 240, y: 118, color: 1, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className={`${PANEL} gap-[10px] px-[12px] pt-[12px]`}>
        <SceneButton accent icon={ArrowLeft} label={t('common.back')} className="self-start" />
        <SceneSlot className="h-[62px] gap-[10px] rounded-[8px] px-[12px]">
          <Puzzle size={20} strokeWidth={1.5} className="shrink-0 text-foreground-tertiary" />
          <span className="flex flex-1 flex-col gap-[6px]">
            <span className="relative block">
              <SceneBar className="w-[70px] bg-muted-foreground opacity-40" />
              <span className="absolute top-1/2 left-0 h-px w-[76px] -translate-y-1/2 bg-foreground-tertiary" />
            </span>
            <SceneBar className="w-[54px]" />
          </span>
          <span className="rounded-full border border-border px-[5px] text-[6.5px] text-foreground-tertiary">404</span>
        </SceneSlot>
        <SceneBar className="w-11/12" />
        <SceneBar className="w-4/5" />
      </ScenePanel>
    </EmptyStateScene>
  )
}

/** A channel type with no instances: its table, an accent add button, and empty rows. */
export function ChannelsEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={2}
      sprites={[
        { x: 232, y: 3, color: 3, shape: 'ring', tilt: 10 },
        { x: 4, y: 86, color: 8, shape: 'checker', tilt: -12 },
        { x: 240, y: 120, color: 2, shape: 'corner', tilt: 8 }
      ]}>
      <ScenePanel className={PANEL}>
        <SceneHeader
          title={<SceneBar className="w-[52px] bg-muted-foreground opacity-50" />}
          trailing={<SceneButton accent icon={Plus} label={t('common.add')} />}
        />
        <div className="flex flex-col gap-[6px] px-[10px] pt-[10px]">
          <SceneGhostRow lead />
          <SceneGhostRow lead />
          <SceneGhostRow lead />
          <SceneGhostRow lead />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}

const QR_FINDERS = ['top-[6px] left-[6px]', 'top-[6px] right-[6px]', 'bottom-[6px] left-[6px]']
const QR_DOTS = [
  'top-[22px] left-[28px]',
  'top-[30px] left-[38px]',
  'top-[40px] left-[26px]',
  'top-[46px] left-[44px]',
  'top-[36px] left-[52px]'
]

/** No paired devices: a pairing code with accent finder marks beside empty device rows. */
export function DevicesEmptyScene() {
  return (
    <EmptyStateScene
      size="panel"
      accent={3}
      sprites={[
        { x: 232, y: 3, color: 4, shape: 'corner', tilt: 10 },
        { x: 4, y: 86, color: 7, shape: 'ring', tilt: -12 },
        { x: 240, y: 120, color: 3, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className={`${PANEL} flex-row gap-[12px] p-[14px]`}>
        <div className="relative size-[70px] shrink-0 rounded-[7px] border border-dashed border-border-strong">
          {QR_FINDERS.map((position) => (
            <SceneSlot
              key={position}
              accent
              className={`absolute ${position} size-[15px] justify-center rounded-[3px] border-[1.5px] border-solid`}>
              <span className="size-[6px] rounded-[1px] bg-current" />
            </SceneSlot>
          ))}
          {QR_DOTS.map((position) => (
            <span key={position} className={`absolute ${position} size-[5px] rounded-[1px] bg-border-strong`} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
          <SceneBar className="h-[5px] w-3/5 bg-muted-foreground opacity-50" />
          <SceneBar className="w-4/5" />
          <SceneSlot className="mt-[4px] h-[18px] gap-[5px] px-[6px]">
            <Laptop size={9} strokeWidth={1.8} className="shrink-0 text-foreground-tertiary" />
            <SceneBar className="w-1/2" />
          </SceneSlot>
          <SceneSlot className="h-[18px] gap-[5px] px-[6px]">
            <Smartphone size={9} strokeWidth={1.8} className="shrink-0 text-foreground-tertiary" />
            <SceneBar className="w-2/5" />
          </SceneSlot>
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
