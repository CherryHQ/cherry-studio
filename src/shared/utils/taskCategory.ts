// Categorises a request without spending a model call — an extra LLM round-trip per message would
// cost more than the routing saves. Turkish and English keywords, since the UI serves both.

import type { TaskCategory } from '@shared/data/preference/preferenceTypes'

/**
 * Turkish is routinely typed without its diacritics ("arastir", "gorsel", "duzelt"), and an
 * accented pattern misses every one of those — the request falls to 'general' and the whole routing
 * layer silently switches itself off. Folding both sides to ASCII is what makes the keywords hold.
 *
 * NFD + combining-mark strip handles the decomposable vowels; dotted and dotless I need explicit
 * rules because U+0131 has no decomposition and lowercasing U+0130 outside a Turkish locale leaves
 * a stray combining dot behind.
 */
export function foldTurkish(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

const PATTERNS: ReadonlyArray<readonly [Exclude<TaskCategory, 'general'>, RegExp]> = [
  ['image', /\b(gorsel|resim|ciz|cizim|fotograf|logo|afis|poster|image|picture|draw|illustration|render)/i],
  // "yazilim" lives here, not under writing, so "yazilim gelistir" is not mistaken for prose.
  //
  // The second line is the "build me a thing" vocabulary. Without it "bana bir todo uygulamasi yap"
  // — the single most common way this gets asked — named no keyword at all and fell to 'general',
  // which sent the biggest job in the app to the default model with an unranked tool set.
  // No trailing \b: Turkish suffixes these ("uygulama" → "uygulamasi", "site" → "sitesi").
  [
    'code',
    /\b(kod|yazilim|fonksiyon|degisken|derle|hata ayikla|refactor|script|sinif|arayuz|code|function|class|bug|debug|compile|stacktrace|typescript|javascript|python|react|sql|regex|endpoint|uygulama|program|proje|mimari|web site|app\b|website|build)/i
  ],
  [
    'research',
    /\b(arastir|karsilastir|kaynak bul|fiyat|hangisi daha|incele|analiz et|research|compare|investigate|benchmark|find out|look up|pros and cons)/i
  ],
  // Trailing \b kept on the short verb "yaz": without it it would swallow half the language.
  [
    'writing',
    /\b(yaz\b|yazi\b|makale|e-posta|mail|dilekce|ozetle|cevir|metin|blog|essay|draft|summarize|translate|rewrite|proofread)/i
  ]
]

/**
 * Best-guess task kind for routing. Returns `'general'` when nothing matches, so an unrecognised
 * request falls back to the user's default model rather than a specialised one.
 */
export function classifyTaskCategory(text: string): TaskCategory {
  const folded = foldTurkish(text)
  for (const [category, pattern] of PATTERNS) {
    if (pattern.test(folded)) return category
  }
  return 'general'
}

export type TaskDifficulty = 'easy' | 'hard'

// Work that needs planning or produces something whole, versus a single local edit.
// No trailing \b: Turkish suffixes words ("uygulama" → "uygulaması"), which a closing boundary
// would refuse to match.
const HARD_SIGNALS =
  /\b(uygulama|proje|sistem|mimari|algoritma|veritabani|entegre|kurgula|tasarla|bastan|sifirdan|application|project|architecture|algorithm|database|refactor|migrate|design)/i
const EASY_SIGNALS =
  /\b(cevir|ozetle|duzelt|yazim|kisalt|baslik|isim oner|ne demek|acikla|translate|summarize|rename|typo|shorten|explain)/i

/** Long prompts describe more work; below this a request is usually a one-liner. */
const HARD_LENGTH_THRESHOLD = 280

/**
 * Splits requests into work that deserves the strongest model and work a cheap one handles just as
 * well — spending a scarce frontier quota on "translate this line" is what exhausts a free tier.
 */
export function estimateTaskDifficulty(text: string): TaskDifficulty {
  const folded = foldTurkish(text)
  if (EASY_SIGNALS.test(folded) && !HARD_SIGNALS.test(folded)) return 'easy'
  if (HARD_SIGNALS.test(folded)) return 'hard'
  return text.length >= HARD_LENGTH_THRESHOLD ? 'hard' : 'easy'
}
