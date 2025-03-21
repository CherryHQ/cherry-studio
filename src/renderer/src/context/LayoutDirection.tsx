import { useAppSelector } from '@renderer/store'
import { createContext, useContext, useEffect } from 'react'

// List of RTL languages
// Reference: https://meta.wikimedia.org/wiki/Template:List_of_language_names_ordered_by_code
const RTL_LANGUAGES = [
  'ar', // Arabic
  'ar-SA',
  'ar-AE',
  'ar-BH',
  'ar-DZ',
  'ar-EG',
  'ar-IQ',
  'ar-JO',
  'ar-KW',
  'ar-LB',
  'ar-LY',
  'ar-MA',
  'ar-OM',
  'ar-QA',
  'ar-SD',
  'ar-SY',
  'ar-TN',
  'ar-YE',
  'arc', // Aramaic
  'dv', // Divehi
  'fa', // Persian
  'fa-IR',
  'fa-AF',
  'ha-Arab', // Hausa (Arabic script)
  'he', // Hebrew
  'he-IL',
  'khw', // Khowar
  'ks', // Kashmiri
  'ku-Arab', // Kurdish (Arabic script)
  'ps', // Pashto
  'ur', // Urdu
  'ur-PK',
  'ur-IN',
  'yi' // Yiddish
]

interface LayoutDirectionContextType {
  isRTL: boolean
  // Utility functions for RTL-aware operations
  getStartDirection: () => 'left' | 'right'
  getEndDirection: () => 'left' | 'right'
  getInlineStartValue: (start: number | string, end: number | string) => number | string
  getInlineEndValue: (start: number | string, end: number | string) => number | string
  flipValue: (value: number | string) => number | string
  mirrorTransform: (transform: string) => string
}

const LayoutDirectionContext = createContext<LayoutDirectionContextType>({
  isRTL: false,
  getStartDirection: () => 'left',
  getEndDirection: () => 'right',
  getInlineStartValue: (start) => start,
  getInlineEndValue: (end) => end,
  flipValue: (value) => value,
  mirrorTransform: (transform) => transform
})

export const useLayoutDirection = () => {
  return useContext(LayoutDirectionContext)
}

export const LayoutDirectionProvider = ({ children }: { children: React.ReactNode }) => {
  const language = useAppSelector((state) => state.settings.language)
  const isRTL = RTL_LANGUAGES.some((rtlLang) => language === rtlLang || language.startsWith(rtlLang + '-'))

  // Utility functions for RTL-aware operations
  const getStartDirection = () => (isRTL ? 'right' : 'left')
  const getEndDirection = () => (isRTL ? 'left' : 'right')

  const getInlineStartValue = (start: number | string, end: number | string) => (isRTL ? end : start)
  const getInlineEndValue = (start: number | string, end: number | string) => (isRTL ? start : end)

  const flipValue = (value: number | string) => {
    if (typeof value === 'number') {
      return -value
    }
    if (typeof value === 'string' && value.endsWith('px')) {
      return `-${value}`
    }
    return value
  }

  const mirrorTransform = (transform: string) => {
    return transform.replace(
      /(translate|rotate|skew|perspective|matrix)(X|3d)?\(([^)]+)\)/g,
      (_, name, dimension, params) => {
        if (dimension === 'X' || (dimension === '3d' && name !== 'perspective')) {
          const values = params.split(',').map((v: string) => -parseFloat(v))
          return `${name}${dimension}(${values.join(',')})`
        }
        return `${name}${dimension || ''}(${params})`
      }
    )
  }

  useEffect(() => {
    // After the language direction changes, update the root HTML element
    const rootHtml = document.getElementById('root-html')
    if (rootHtml) {
      rootHtml.setAttribute('dir', isRTL ? 'rtl' : 'ltr')
      // Also set lang attribute for better accessibility
      rootHtml.setAttribute('lang', language)
    }
  }, [isRTL, language])

  const value = {
    isRTL,
    getStartDirection,
    getEndDirection,
    getInlineStartValue,
    getInlineEndValue,
    flipValue,
    mirrorTransform
  }

  return <LayoutDirectionContext.Provider value={value}>{children}</LayoutDirectionContext.Provider>
}
