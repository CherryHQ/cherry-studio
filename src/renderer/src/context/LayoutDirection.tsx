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
  direction: 'ltr' | 'rtl'
  startDirection: 'left' | 'right'
  endDirection: 'left' | 'right'
}

const LayoutDirectionContext = createContext<LayoutDirectionContextType>({
  isRTL: false,
  direction: 'ltr',
  startDirection: 'left',
  endDirection: 'right'
})

export function useLayoutDirection() {
  return useContext(LayoutDirectionContext)
}

interface LayoutDirectionProviderProps {
  children: React.ReactNode
}

export function LayoutDirectionProvider({ children }: LayoutDirectionProviderProps) {
  const language = useAppSelector((state) => state.settings.language)
  const isRTL = RTL_LANGUAGES.includes(language)
  const direction = isRTL ? 'rtl' : 'ltr'
  const startDirection = isRTL ? 'right' : 'left'
  const endDirection = isRTL ? 'left' : 'right'

  useEffect(() => {
    document.documentElement.dir = direction
    document.documentElement.lang = language
  }, [direction, language])

  const value = {
    isRTL,
    direction: direction as 'ltr' | 'rtl',
    startDirection: startDirection as 'left' | 'right',
    endDirection: endDirection as 'left' | 'right'
  }

  return <LayoutDirectionContext.Provider value={value}>{children}</LayoutDirectionContext.Provider>
}
