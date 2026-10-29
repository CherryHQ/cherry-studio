import { Check, ChevronRight, Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { useAccountSubmenu } from '@renderer/hooks/useAccountSubmenu'
import { useTheme } from '@renderer/hooks/useTheme'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

export function AppearanceMenu({ onRequestClose }: { onRequestClose?: () => void }) {
  const { t } = useTranslation()
  const { settedTheme, setTheme } = useTheme()
  const { open, onOpenChange, initialFocusRef, triggerProps, contentProps } = useAccountSubmenu()
  const labels = {
    [ThemeMode.light]: t('settings.theme.light'),
    [ThemeMode.dark]: t('settings.theme.dark'),
    [ThemeMode.system]: t('settings.theme.system')
  }
  const icons = { [ThemeMode.light]: Sun, [ThemeMode.dark]: Moon, [ThemeMode.system]: Monitor }
  const CurrentThemeIcon = icons[settedTheme]
  const options = [ThemeMode.light, ThemeMode.dark, ThemeMode.system]

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('settings.appearance.title')}
          {...triggerProps}
          className="h-8 min-h-8 w-full justify-start gap-2 rounded-md bg-transparent px-2 py-0 text-[13px] text-foreground leading-5">
          <CurrentThemeIcon className="!text-muted-foreground size-4" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">{t('settings.appearance.title')}</span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <span>{labels[settedTheme]}</span>
            <ChevronRight className="size-4" aria-hidden />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={t('settings.appearance.title')}
        align="end"
        side="right"
        sideOffset={8}
        className="w-52 rounded-md p-1.5"
        {...contentProps}>
        <MenuList role="group" aria-label={t('settings.appearance.title')} className="gap-0.5">
          {options.map((value) => {
            const Icon = icons[value]
            return (
              <MenuItem
                key={value}
                ref={value === settedTheme ? initialFocusRef : undefined}
                aria-pressed={value === settedTheme}
                size="sm"
                className="h-8 gap-2 rounded-md border-0 bg-transparent px-2 py-0 text-[13px] leading-5 [&_svg]:text-muted-foreground"
                icon={<Icon size={16} />}
                label={labels[value]}
                suffix={value === settedTheme ? <Check size={16} aria-hidden /> : undefined}
                onClick={() => {
                  setTheme(value)
                  onOpenChange(false)
                  onRequestClose?.()
                }}
              />
            )
          })}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
