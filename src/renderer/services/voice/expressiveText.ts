/**
 * Turns emoji and kaomoji into words the speech engine can pronounce.
 *
 * The chat text keeps its emoji; only the text handed to TTS is rewritten.
 * Labels follow the interface language, so a Chinese voice reads `[开心]` and
 * an English voice reads `[happy]`. Emoji without a label are dropped instead
 * of being spelled out character by character.
 */

import { EMOJI_SEQUENCE_GLOBAL } from '@shared/utils/emojiSequence'

export type SpeechLanguage = 'zh' | 'en'

interface Label {
  zh: string
  en: string
}

export interface CustomExpressiveRule {
  kind: 'emoji' | 'kaomoji'
  match: string
  zh: string
  en: string
}

let expressiveEnabled = true
let customEmoji: Record<string, Label> = {}
let customKaomoji: Array<{ match: string; label: Label }> = []

const EMOJI_LABELS: Record<string, Label> = {
  '😀': { zh: '高兴', en: 'happy' },
  '😃': { zh: '开心', en: 'happy' },
  '😄': { zh: '开心', en: 'happy' },
  '😁': { zh: '咧嘴笑', en: 'grinning' },
  '😆': { zh: '大笑', en: 'laughing' },
  '😅': { zh: '尴尬', en: 'awkward' },
  '😂': { zh: '大笑', en: 'laughing' },
  '🤣': { zh: '捧腹大笑', en: 'laughing hard' },
  '😊': { zh: '微笑', en: 'smiling' },
  '😇': { zh: '乖巧', en: 'innocent' },
  '🙂': { zh: '微笑', en: 'smiling' },
  '🙃': { zh: '无奈', en: 'upside down' },
  '😉': { zh: '眨眼', en: 'winking' },
  '😍': { zh: '喜欢', en: 'love' },
  '🥰': { zh: '喜爱', en: 'adoring' },
  '😘': { zh: '飞吻', en: 'kiss' },
  '😋': { zh: '好吃', en: 'yummy' },
  '😎': { zh: '酷', en: 'cool' },
  '🤓': { zh: '书呆子', en: 'nerdy' },
  '🧐': { zh: '审视', en: 'examining' },
  '🤔': { zh: '思考', en: 'thinking' },
  '🤨': { zh: '疑惑', en: 'skeptical' },
  '😐': { zh: '无语', en: 'speechless' },
  '😑': { zh: '无语', en: 'speechless' },
  '😶': { zh: '沉默', en: 'silent' },
  '🙄': { zh: '翻白眼', en: 'rolling eyes' },
  '😏': { zh: '得意', en: 'smug' },
  '😣': { zh: '难受', en: 'struggling' },
  '😥': { zh: '担心', en: 'worried' },
  '😮': { zh: '惊讶', en: 'surprised' },
  '🤯': { zh: '震惊', en: 'shocked' },
  '😱': { zh: '惊恐', en: 'terrified' },
  '😳': { zh: '脸红', en: 'blushing' },
  '🥵': { zh: '热', en: 'hot' },
  '🥶': { zh: '冷', en: 'cold' },
  '😴': { zh: '困了', en: 'sleepy' },
  '🤤': { zh: '流口水', en: 'drooling' },
  '😷': { zh: '生病', en: 'sick' },
  '🤒': { zh: '发烧', en: 'fever' },
  '🤕': { zh: '受伤', en: 'hurt' },
  '😵': { zh: '晕', en: 'dizzy' },
  '🤐': { zh: '闭嘴', en: 'zipped mouth' },
  '🥳': { zh: '庆祝', en: 'celebrating' },
  '🥺': { zh: '委屈', en: 'pleading' },
  '😢': { zh: '难过', en: 'sad' },
  '😭': { zh: '大哭', en: 'crying' },
  '😤': { zh: '生气', en: 'huffing' },
  '😠': { zh: '生气', en: 'angry' },
  '😡': { zh: '愤怒', en: 'furious' },
  '🤬': { zh: '暴怒', en: 'swearing' },
  '🤗': { zh: '拥抱', en: 'hugging' },
  '🤭': { zh: '偷笑', en: 'giggling' },
  '🤫': { zh: '安静', en: 'quiet' },
  '🫡': { zh: '敬礼', en: 'saluting' },
  '😬': { zh: '咬牙', en: 'grimacing' },
  '🫠': { zh: '融化', en: 'melting' },
  '👍': { zh: '赞同', en: 'thumbs up' },
  '👎': { zh: '反对', en: 'thumbs down' },
  '👌': { zh: '好的', en: 'okay' },
  '✌': { zh: '胜利', en: 'victory' },
  '🤞': { zh: '祈祷', en: 'fingers crossed' },
  '🤟': { zh: '爱你', en: 'love you' },
  '👏': { zh: '鼓掌', en: 'applause' },
  '🙌': { zh: '欢呼', en: 'hooray' },
  '🤝': { zh: '握手', en: 'handshake' },
  '🙏': { zh: '感谢', en: 'thanks' },
  '💪': { zh: '加油', en: 'strong' },
  '🫶': { zh: '比心', en: 'heart hands' },
  '👀': { zh: '围观', en: 'looking' },
  '🧠': { zh: '大脑', en: 'brain' },
  '❤': { zh: '喜欢', en: 'love' },
  '🧡': { zh: '喜欢', en: 'love' },
  '💛': { zh: '喜欢', en: 'love' },
  '💚': { zh: '喜欢', en: 'love' },
  '💙': { zh: '喜欢', en: 'love' },
  '💜': { zh: '喜欢', en: 'love' },
  '🖤': { zh: '喜欢', en: 'love' },
  '🤍': { zh: '喜欢', en: 'love' },
  '💔': { zh: '心碎', en: 'heartbroken' },
  '💯': { zh: '满分', en: 'perfect' },
  '✅': { zh: '完成', en: 'done' },
  '❌': { zh: '错误', en: 'wrong' },
  '⚠': { zh: '警告', en: 'warning' },
  '❓': { zh: '疑问', en: 'question' },
  '❗': { zh: '注意', en: 'attention' },
  '🔥': { zh: '火热', en: 'fire' },
  '✨': { zh: '闪光', en: 'sparkles' },
  '🎉': { zh: '庆祝', en: 'celebration' },
  '🎊': { zh: '庆祝', en: 'celebration' },
  '🚀': { zh: '启动', en: 'launch' },
  '💡': { zh: '点子', en: 'idea' },
  '⭐': { zh: '推荐', en: 'star' },
  '🌟': { zh: '闪亮', en: 'glowing star' },
  '📌': { zh: '重点', en: 'pin' },
  '📝': { zh: '记录', en: 'note' },
  '🔍': { zh: '搜索', en: 'search' },
  '⏰': { zh: '时间', en: 'alarm' },
  '💰': { zh: '钱', en: 'money' },
  '🎁': { zh: '礼物', en: 'gift' },
  '🍀': { zh: '好运', en: 'lucky' },
  '☕': { zh: '咖啡', en: 'coffee' },
  '🌙': { zh: '晚安', en: 'good night' },
  '☀': { zh: '晴天', en: 'sunny' },
  '👨‍👩‍👧': { zh: '一家人', en: 'family' },
  '🧑‍💻': { zh: '程序员', en: 'developer' },
  '👩‍💻': { zh: '女程序员', en: 'developer' },
  '🙋': { zh: '举手', en: 'raising hand' },
  '🤷': { zh: '摊手', en: 'shrug' }
}

/**
 * Kaomoji are matched by shape rather than by an exhaustive list. Each pattern
 * requires the special characters that make the face, so ordinary parentheses
 * such as `(a+b)` are left alone.
 */
const KAOMOJI: Array<{ pattern: RegExp; label: Label }> = [
  { pattern: /\(\s*[＾^][▽_^][＾^]\s*\)/gu, label: { zh: '开心', en: 'happy' } },
  { pattern: /\(\s*[TＴ][_-][TＴ]\s*\)/gu, label: { zh: '难过', en: 'sad' } },
  { pattern: /\(\s*[；;]_[；;]\s*\)/gu, label: { zh: '难过', en: 'sad' } },
  { pattern: /\(\s*ㄒ[oｏ][ㄒ]\s*\)/gu, label: { zh: '难过', en: 'sad' } },
  { pattern: /\(╯[^)]{0,6}\)╯︵\s*┻━┻/gu, label: { zh: '掀桌', en: 'flipping the table' } },
  { pattern: /¯\\_\(ツ\)_\/¯/gu, label: { zh: '摊手', en: 'shrug' } },
  { pattern: /\(\s*￣[︶▽][￣]\s*\)/gu, label: { zh: '得意', en: 'smug' } },
  { pattern: /\(\s*°[▽口o_o][°]\s*\)/gu, label: { zh: '惊讶', en: 'surprised' } },
  { pattern: /\(\s*¬[_-]¬\s*\)/gu, label: { zh: '无语', en: 'speechless' } },
  { pattern: /\(\s*[＠@]_[＠@];?\s*\)/gu, label: { zh: '困惑', en: 'confused' } },
  { pattern: /\(\s*[´｀][・ω・][´｀]\s*\)/gu, label: { zh: '自信', en: 'confident' } },
  { pattern: /\(๑[^)]{0,8}و✧\)/gu, label: { zh: '加油', en: 'cheering' } },
  { pattern: /\(づ[^)]{0,10}づ\)/gu, label: { zh: '抱抱', en: 'hug' } }
]

/**
 * Every complete sequence (flags, keycaps, ZWJ, skin tones, tags) is matched as
 * one unit, so an exact custom rule such as `🇺🇸` resolves instead of two halves.
 */
const EMOJI_PATTERN = EMOJI_SEQUENCE_GLOBAL

/** Code spans are wrapped in these private-use markers so they stay verbatim. */
const SPEECH_CODE_OPEN = '\uE000'
const SPEECH_CODE_CLOSE = '\uE001'
const SPEECH_CODE_SPAN = /\uE000([\s\S]*?)\uE001/g

/** Marks code so `expressiveToSpeech` reads it literally. */
export function protectCodeForSpeech(value: string): string {
  return `${SPEECH_CODE_OPEN}${value}${SPEECH_CODE_CLOSE}`
}

/** True when a value already carries code markers. */
export function isProtectedCode(value: string): boolean {
  return value.includes(SPEECH_CODE_OPEN)
}

export function speechLanguageFromLocale(locale: string | undefined): SpeechLanguage {
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function lookupKey(value: string): string {
  return value.replace(/\uFE0F/gu, '').replace(/\p{Emoji_Modifier}/gu, '')
}

function labelFor(match: string): Label | undefined {
  const key = lookupKey(match)
  return customEmoji[match] ?? customEmoji[key] ?? EMOJI_LABELS[match] ?? EMOJI_LABELS[key]
}

/** The settings switch; a paused switch leaves the text untouched. */
export function setExpressiveEnabled(enabled: boolean): void {
  expressiveEnabled = enabled
}

/** Replaces the custom layer; the built-in table stays as the fallback. */
export function setCustomExpressiveRules(rules: readonly CustomExpressiveRule[]): void {
  const emoji: Record<string, Label> = {}
  const kaomoji: Array<{ match: string; label: Label }> = []
  for (const rule of rules) {
    const label = { zh: rule.zh, en: rule.en }
    if (rule.kind === 'emoji') emoji[rule.match] = label
    else kaomoji.push({ match: rule.match, label })
  }
  customEmoji = emoji
  customKaomoji = kaomoji.sort((left, right) => right.match.length - left.match.length)
}

function rewriteExpressions(text: string, language: SpeechLanguage): string {
  let result = text
  for (const { match, label } of customKaomoji) {
    result = result.split(match).join(`[${label[language]}]`)
  }
  for (const { pattern, label } of KAOMOJI) {
    result = result.replace(pattern, `[${label[language]}]`)
  }
  return result.replace(EMOJI_PATTERN, (match) => {
    const label = labelFor(match)
    return label ? `[${label[language]}]` : ''
  })
}

/** Rewrites prose and leaves every protected code span byte-for-byte intact. */
function rewriteProseOnly(text: string, language: SpeechLanguage): string {
  let result = ''
  let last = 0
  for (const match of text.matchAll(SPEECH_CODE_SPAN)) {
    const start = match.index ?? 0
    result += rewriteExpressions(text.slice(last, start), language)
    result += match[1]
    last = start + match[0].length
  }
  return result + rewriteExpressions(text.slice(last), language)
}

function stripCodeProtection(text: string): string {
  return text.replace(SPEECH_CODE_SPAN, '$1')
}

/**
 * Rewrites emoji and kaomoji as bracketed labels. Unknown emoji are removed:
 * a speech engine either skips them silently or reads a description in the
 * wrong language, and neither is useful. Code wrapped by
 * `protectCodeForSpeech` is never rewritten.
 */
export function expressiveToSpeech(text: string, language: SpeechLanguage): string {
  if (!text) return text

  const protectedCode = isProtectedCode(text)
  if (!expressiveEnabled) return protectedCode ? stripCodeProtection(text) : text

  const rewritten = protectedCode ? rewriteProseOnly(text, language) : rewriteExpressions(text, language)
  return rewritten.replace(/[ \t]{2,}/g, ' ').trim()
}
