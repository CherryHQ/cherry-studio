import { usePreference } from '@data/hooks/usePreference'
import Color, { type ColorInstance } from 'color'

const MIN_TEXT_CONTRAST = 4.5
const LIGHT_THEME_SURFACE = Color('#ffffff')
const DARK_THEME_SURFACE = Color('#151514')
const LIGHT_CONTENT = Color('#ffffff')
const DARK_CONTENT = Color('#1a1c1f')

function getThemeSurface(): ColorInstance {
  return document.body.classList.contains('dark') ? DARK_THEME_SURFACE : LIGHT_THEME_SURFACE
}

function getReadableAccentText(accent: ColorInstance, surface: ColorInstance): ColorInstance {
  if (accent.contrast(surface) >= MIN_TEXT_CONTRAST) {
    return accent
  }

  const readableTarget = surface.isLight() ? DARK_CONTENT : LIGHT_CONTENT
  let insufficientWeight = 0
  let sufficientWeight = 1
  let readableAccent = readableTarget

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const weight = (insufficientWeight + sufficientWeight) / 2
    const candidate = accent.mix(readableTarget, weight)

    if (candidate.contrast(surface) >= MIN_TEXT_CONTRAST) {
      readableAccent = candidate
      sufficientWeight = weight
    } else {
      insufficientWeight = weight
    }
  }

  return readableAccent
}

function getAccentForeground(accent: ColorInstance): ColorInstance {
  return accent.contrast(LIGHT_CONTENT) >= accent.contrast(DARK_CONTENT) ? LIGHT_CONTENT : DARK_CONTENT
}

export default function useUserTheme() {
  const [colorPrimary, setColorPrimary] = usePreference('ui.theme_user.color_primary')
  const [userFontFamily, setUserFontFamily] = usePreference('ui.theme_user.font_family')
  const [userCodeFontFamily, setUserCodeFontFamily] = usePreference('ui.theme_user.code_font_family')

  const setOptionalCssVar = (name: string, value?: string) => {
    if (value?.trim()) {
      document.documentElement.style.setProperty(name, `'${value}'`)
      return
    }

    document.documentElement.style.removeProperty(name)
  }

  const initUserTheme = (theme: { colorPrimary: string } = { colorPrimary }) => {
    const accent = Color(theme.colorPrimary)
    const accentText = getReadableAccentText(accent, getThemeSurface())
    const accentForeground = getAccentForeground(accent)

    document.documentElement.style.setProperty('--cs-theme-accent', accent.toString())
    document.documentElement.style.setProperty('--cs-theme-accent-text', accentText.toString())
    document.documentElement.style.setProperty('--cs-theme-accent-foreground', accentForeground.toString())
    setOptionalCssVar('--cs-user-font-family', userFontFamily)
    setOptionalCssVar('--cs-user-code-font-family', userCodeFontFamily)
  }

  return {
    colorPrimary: Color(colorPrimary),

    initUserTheme,

    userTheme: { colorPrimary, userFontFamily, userCodeFontFamily },

    setUserTheme(userTheme: { colorPrimary: string; userFontFamily: string; userCodeFontFamily: string }) {
      void setColorPrimary(userTheme.colorPrimary)
      void setUserFontFamily(userTheme.userFontFamily)
      void setUserCodeFontFamily(userTheme.userCodeFontFamily)
      initUserTheme(userTheme)
    }
  }
}
