export {
  SettingContainer,
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingRow,
  SettingRowTitle,
  SettingsContentBody,
  SettingsContentColumn,
  SettingSubtitle,
  SettingTitle,
  SettingTitleExternalLink
} from '@renderer/components/SettingsPrimitives'

export const settingsSubmenuScrollClassName =
  'h-[calc(100vh-var(--navbar-height))] w-(--settings-width) border-border border-e-[0.5px]'

export const settingsSubmenuListClassName = 'flex flex-col gap-1 px-2.5 pb-2.5 [box-sizing:border-box]'

export const settingsSubmenuItemClassName =
  'h-8 rounded-[10px] border-transparent px-2.5 font-normal text-foreground text-sm hover:!bg-muted data-[active=true]:!border-transparent data-[active=true]:!bg-muted data-[active=true]:!font-medium data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-foreground'

export const settingsSubmenuItemLabelClassName = 'group-data-[active=true]:font-medium'

export const settingsSubmenuSectionTitleClassName =
  'px-2.5 pt-1.5 pb-1 font-normal text-foreground-muted text-xs first:pt-0'

export const settingsSubmenuDividerClassName = 'my-1 bg-transparent'

export const settingsContentScrollClassName = 'flex-1 min-h-0 min-w-0 overflow-x-hidden'

export const settingsContentBodyClassName = 'flex min-h-full w-full flex-col px-6 py-4'

export const settingsContentHeaderClassName = 'mb-5'

export const settingsContentHeaderTitleClassName = 'font-semibold text-foreground text-[15px]'

export const settingsContentHeaderDescriptionClassName = 'mt-1 text-foreground-muted text-sm'
