import { createInstance, type i18n } from 'i18next'
import { createContext, use, useMemo, type FC, type ReactNode } from 'react'

export type UarLocale = 'en' | 'es' | 'ja' | 'zh'
export type UarDirection = 'auto' | 'ltr' | 'rtl'

const resources = {
  en: {
    translation: {
      choices: 'Choices',
      empty: 'This surface has no content yet.',
      errorTitle: 'This surface could not be displayed',
      errorBody: 'The generated interface was not valid. You can retry without leaving this page.',
      retry: 'Retry',
      receiving: 'Receiving updates…',
      noMessages: 'No messages yet.',
      conversation: 'Conversation',
      entityChanges: 'Entity changes',
      field: 'Field',
      before: 'Before',
      after: 'After',
      action: 'Action',
      dismiss: 'Dismiss',
      decisionPending: 'Decision in progress…',
      idle: 'Idle',
      complete: 'Complete',
      error: 'Error',
      available: 'Available',
      running: 'Running',
      unavailable: 'Unavailable',
      user: 'User',
      assistant: 'Assistant',
      system: 'System'
    }
  },
  es: {
    translation: {
      choices: 'Opciones',
      empty: 'Esta superficie aún no tiene contenido.',
      errorTitle: 'No se pudo mostrar esta superficie',
      errorBody: 'La interfaz generada no era válida. Puedes volver a intentarlo sin salir de esta página.',
      retry: 'Reintentar',
      receiving: 'Recibiendo actualizaciones…',
      noMessages: 'Aún no hay mensajes.',
      conversation: 'Conversación',
      entityChanges: 'Cambios de entidad',
      field: 'Campo',
      before: 'Antes',
      after: 'Después',
      action: 'Acción',
      dismiss: 'Cerrar',
      decisionPending: 'Decisión en curso…',
      idle: 'Inactivo',
      complete: 'Completado',
      error: 'Error',
      available: 'Disponible',
      running: 'En ejecución',
      unavailable: 'No disponible',
      user: 'Usuario',
      assistant: 'Asistente',
      system: 'Sistema'
    }
  },
  ja: {
    translation: {
      choices: '選択肢',
      empty: 'このサーフェスにはまだコンテンツがありません。',
      errorTitle: 'このサーフェスを表示できませんでした',
      errorBody: '生成されたインターフェースは無効でした。このページを離れずに再試行できます。',
      retry: '再試行',
      receiving: '更新を受信中…',
      noMessages: 'メッセージはまだありません。',
      conversation: '会話',
      entityChanges: 'エンティティの変更',
      field: 'フィールド',
      before: '変更前',
      after: '変更後',
      action: 'アクション',
      dismiss: '閉じる',
      decisionPending: '決定を処理中…',
      idle: '待機中',
      complete: '完了',
      error: 'エラー',
      available: '利用可能',
      running: '実行中',
      unavailable: '利用不可',
      user: 'ユーザー',
      assistant: 'アシスタント',
      system: 'システム'
    }
  },
  zh: {
    translation: {
      choices: '选项',
      empty: '此界面尚无内容。',
      errorTitle: '无法显示此界面',
      errorBody: '生成的界面无效。你可以留在此页面重试。',
      retry: '重试',
      receiving: '正在接收更新…',
      noMessages: '暂无消息。',
      conversation: '对话',
      entityChanges: '实体更改',
      field: '字段',
      before: '之前',
      after: '之后',
      action: '操作',
      dismiss: '关闭',
      decisionPending: '正在处理决定…',
      idle: '空闲',
      complete: '完成',
      error: '错误',
      available: '可用',
      running: '运行中',
      unavailable: '不可用',
      user: '用户',
      assistant: '助手',
      system: '系统'
    }
  }
} as const

export type UarMessageKey = keyof typeof resources.en.translation

interface UarI18nValue {
  locale: UarLocale
  dir: 'ltr' | 'rtl'
  t: (key: UarMessageKey) => string
}

const defaultValue: UarI18nValue = {
  locale: 'en',
  dir: 'ltr',
  t: (key) => resources.en.translation[key]
}

const UarI18nContext = createContext<UarI18nValue>(defaultValue)

function createTranslator(locale: UarLocale): i18n {
  const instance = createInstance()
  void instance.init({
    lng: locale,
    fallbackLng: 'en',
    resources,
    initAsync: false,
    interpolation: { escapeValue: false }
  })
  return instance
}

export const UarI18nProvider: FC<{ locale?: UarLocale; direction?: UarDirection; children: ReactNode }> = ({
  locale = 'en',
  direction = 'auto',
  children
}) => {
  const value = useMemo<UarI18nValue>(() => {
    const instance = createTranslator(locale)
    const dir = direction === 'auto' ? instance.dir(locale) : direction
    return { locale, dir, t: (key) => instance.t(key) }
  }, [locale, direction])
  return <UarI18nContext value={value}>{children}</UarI18nContext>
}

export function useUarI18n(): UarI18nValue {
  return use(UarI18nContext)
}

export { resources as uarI18nResources }
