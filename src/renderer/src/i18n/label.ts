import i18n from './index'

const t = i18n.t

/** 使用函数形式是为了动态获取，如果使用静态对象的话，导出的对象将不会随语言切换而改变 */

export const getProviderLabel = (key: string): string => {
  const labelMap = {
    '302ai': t('provider.302ai'),
    aihubmix: t('provider.aihubmix'),
    alayanew: t('provider.alayanew'),
    anthropic: t('provider.anthropic'),
    'azure-openai': t('provider.azure-openai'),
    baichuan: t('provider.baichuan'),
    'baidu-cloud': t('provider.baidu-cloud'),
    burncloud: t('provider.burncloud'),
    cephalon: t('provider.cephalon'),
    copilot: t('provider.copilot'),
    dashscope: t('provider.dashscope'),
    deepseek: t('provider.deepseek'),
    dmxapi: t('provider.dmxapi'),
    doubao: t('provider.doubao'),
    fireworks: t('provider.fireworks'),
    gemini: t('provider.gemini'),
    'gitee-ai': t('provider.gitee-ai'),
    github: t('provider.github'),
    gpustack: t('provider.gpustack'),
    grok: t('provider.grok'),
    groq: t('provider.groq'),
    hunyuan: t('provider.hunyuan'),
    hyperbolic: t('provider.hyperbolic'),
    infini: t('provider.infini'),
    jina: t('provider.jina'),
    lanyun: t('provider.lanyun'),
    lmstudio: t('provider.lmstudio'),
    minimax: t('provider.minimax'),
    mistral: t('provider.mistral'),
    modelscope: t('provider.modelscope'),
    moonshot: t('provider.moonshot'),
    'new-api': t('provider.new-api'),
    nvidia: t('provider.nvidia'),
    o3: t('provider.o3'),
    ocoolai: t('provider.ocoolai'),
    ollama: t('provider.ollama'),
    openai: t('provider.openai'),
    openrouter: t('provider.openrouter'),
    perplexity: t('provider.perplexity'),
    ph8: t('provider.ph8'),
    ppio: t('provider.ppio'),
    qiniu: t('provider.qiniu'),
    qwenlm: t('provider.qwenlm'),
    silicon: t('provider.silicon'),
    stepfun: t('provider.stepfun'),
    'tencent-cloud-ti': t('provider.tencent-cloud-ti'),
    together: t('provider.together'),
    tokenflux: t('provider.tokenflux'),
    vertexai: t('provider.vertexai'),
    voyageai: t('provider.voyageai'),
    xirang: t('provider.xirang'),
    yi: t('provider.yi'),
    zhinao: t('provider.zhinao'),
    zhipu: t('provider.zhipu')
  } as const
  return labelMap[key] ?? key
}

export const getProgressLabel = (key: string): string => {
  const labelMap = {
    completed: t('backup.progress.completed'),
    compressing: t('backup.progress.compressing'),
    copying_files: t('backup.progress.copying_files'),
    preparing: t('backup.progress.preparing'),
    title: t('backup.progress.title'),
    writing_data: t('backup.progress.writing_data')
  } as const
  return labelMap[key] ?? key
}

export const getTitleLabel = (key: string): string => {
  const labelMap = {
    agents: t('title.agents'),
    apps: t('title.apps'),
    files: t('title.files'),
    home: t('title.home'),
    knowledge: t('title.knowledge'),
    launchpad: t('title.launchpad'),
    'mcp-servers': t('title.mcp-servers'),
    memories: t('title.memories'),
    paintings: t('title.paintings'),
    settings: t('title.settings'),
    translate: t('title.translate')
  } as const
  return labelMap[key] ?? key
}

export const getThemeModeLabel = (key: string): string => {
  const labelMap = {
    dark: t('settings.theme.dark'),
    light: t('settings.theme.light'),
    system: t('settings.theme.system')
  } as const
  return labelMap[key] ?? key
}

export const getSidebarIconLabel = (key: string): string => {
  const labelMap = {
    assistants: t('assistants.title'),
    agents: t('agents.title'),
    paintings: t('paintings.title'),
    translate: t('translate.title'),
    minapp: t('minapp.title'),
    knowledge: t('knowledge.title'),
    files: t('files.title')
  } as const
  return labelMap[key] ?? key
}

export const getShortcutLabel = (key: string): string => {
  const labelMap = {
    action: t('settings.shortcuts.action'),
    actions: t('settings.shortcuts.actions'),
    clear_shortcut: t('settings.shortcuts.clear_shortcut'),
    clear_topic: t('settings.shortcuts.clear_topic'),
    copy_last_message: t('settings.shortcuts.copy_last_message'),
    enabled: t('settings.shortcuts.enabled'),
    exit_fullscreen: t('settings.shortcuts.exit_fullscreen'),
    label: t('settings.shortcuts.label'),
    mini_window: t('settings.shortcuts.mini_window'),
    new_topic: t('settings.shortcuts.new_topic'),
    press_shortcut: t('settings.shortcuts.press_shortcut'),
    reset_defaults: t('settings.shortcuts.reset_defaults'),
    reset_defaults_confirm: t('settings.shortcuts.reset_defaults_confirm'),
    reset_to_default: t('settings.shortcuts.reset_to_default'),
    search_message: t('settings.shortcuts.search_message'),
    search_message_in_chat: t('settings.shortcuts.search_message_in_chat'),
    selection_assistant_select_text: t('settings.shortcuts.selection_assistant_select_text'),
    selection_assistant_toggle: t('settings.shortcuts.selection_assistant_toggle'),
    show_app: t('settings.shortcuts.show_app'),
    show_settings: t('settings.shortcuts.show_settings'),
    title: t('settings.shortcuts.title'),
    toggle_new_context: t('settings.shortcuts.toggle_new_context'),
    toggle_show_assistants: t('settings.shortcuts.toggle_show_assistants'),
    toggle_show_topics: t('settings.shortcuts.toggle_show_topics'),
    zoom_in: t('settings.shortcuts.zoom_in'),
    zoom_out: t('settings.shortcuts.zoom_out'),
    zoom_reset: t('settings.shortcuts.zoom_reset')
  } as const
  return labelMap[key] ?? key
}

export const getSelectionDescriptionLabel = (key: string): string => {
  const labelMap = {
    mac: t('selection.settings.toolbar.trigger_mode.description_note.mac'),
    windows: t('selection.settings.toolbar.trigger_mode.description_note.windows')
  } as const
  return labelMap[key] ?? key
}

export const getPaintingsImageSizeOptionsLabel = (key: string): string => {
  const labelMap = {
    auto: t('paintings.image_size_options.auto')
  } as const
  return labelMap[key] ?? key
}

export const getPaintingsQualityOptionsLabel = (key: string): string => {
  const labelMap = {
    auto: t('paintings.quality_options.auto'),
    high: t('paintings.quality_options.high'),
    low: t('paintings.quality_options.low'),
    medium: t('paintings.quality_options.medium')
  } as const
  return labelMap[key] ?? key
}

export const getPaintingsModerationOptionsLabel = (key: string): string => {
  const labelMap = {
    auto: t('paintings.moderation_options.auto'),
    low: t('paintings.moderation_options.low')
  } as const
  return labelMap[key] ?? key
}

export const getPaintingsBackgroundOptionsLabel = (key: string): string => {
  const labelMap = {
    auto: t('paintings.background_options.auto'),
    opaque: t('paintings.background_options.opaque'),
    transparent: t('paintings.background_options.transparent')
  } as const
  return labelMap[key] ?? key
}

export const getMcpTypeLabel = (key: string): string => {
  const labelMap = {
    inMemory: t('settings.mcp.types.inMemory'),
    sse: t('settings.mcp.types.sse'),
    stdio: t('settings.mcp.types.stdio'),
    streamableHttp: t('settings.mcp.types.streamableHttp')
  } as const
  return labelMap[key] ?? key
}

export const getMiniappsStatusLabel = (key: string): string => {
  const labelMap = {
    visible: t('settings.miniapps.visible'),
    disabled: t('settings.miniapps.disabled')
  } as const
  return labelMap[key] ?? key
}

export const getHttpMessageLabel = (key: string): string => {
  const labelMap = {
    '400': t('error.http.400'),
    '401': t('error.http.401'),
    '403': t('error.http.403'),
    '404': t('error.http.404'),
    '429': t('error.http.429'),
    '500': t('error.http.500'),
    '502': t('error.http.502'),
    '503': t('error.http.503'),
    '504': t('error.http.504')
  } as const
  return labelMap[key] ?? key
}

export const getReasoningEffortOptionsLabel = (key: string): string => {
  const labelMap = {
    auto: t('assistants.settings.reasoning_effort.default'),
    high: t('assistants.settings.reasoning_effort.high'),
    label: t('assistants.settings.reasoning_effort.label'),
    low: t('assistants.settings.reasoning_effort.low'),
    medium: t('assistants.settings.reasoning_effort.medium'),
    off: t('assistants.settings.reasoning_effort.off')
  } as const
  return labelMap[key] ?? key
}

export const getFileFieldLabel = (key: string): string => {
  const labelMap = {
    created_at: t('files.created_at'),
    size: t('files.size'),
    name: t('files.name')
  } as const
  return labelMap[key] ?? key
}
