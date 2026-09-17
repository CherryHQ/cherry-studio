import { describe, expect, it } from 'vitest'

import { classifyTaskCategory, estimateTaskDifficulty } from '../taskCategory'

describe('classifyTaskCategory', () => {
  it('routes a Turkish coding request to code', () => {
    expect(classifyTaskCategory('şu fonksiyonu refactor et, hata veriyor')).toBe('code')
  })

  it('routes a Turkish price comparison to research', () => {
    expect(classifyTaskCategory('elektro gitar fiyatlarını araştır, hangisi daha ucuz')).toBe('research')
  })

  it('routes an image request to image', () => {
    expect(classifyTaskCategory('bana bir logo çiz')).toBe('image')
  })

  it('routes a drafting request to writing', () => {
    expect(classifyTaskCategory('bu maili daha kibar yaz')).toBe('writing')
  })

  it('falls back to general for small talk, so routing never hijacks a plain chat', () => {
    expect(classifyTaskCategory('naber')).toBe('general')
  })

  it('prefers image over code when a prompt mentions both, since output shape decides the model', () => {
    expect(classifyTaskCategory('react ile bir logo çiz')).toBe('image')
  })
})

describe('estimateTaskDifficulty', () => {
  it('treats building something whole as hard work', () => {
    expect(estimateTaskDifficulty('bana bir e-ticaret uygulaması yap')).toBe('hard')
  })

  it('treats a one-line edit as easy, so it never claims the strongest model', () => {
    expect(estimateTaskDifficulty('bu cümleyi çevir')).toBe('easy')
  })

  it('prefers the hard signal when a request mixes both', () => {
    expect(estimateTaskDifficulty('bu metni çevir ve sıfırdan bir sistem mimarisi kur')).toBe('hard')
  })

  it('falls back to length when no keyword decides it', () => {
    expect(estimateTaskDifficulty('merhaba')).toBe('easy')
    expect(estimateTaskDifficulty('x'.repeat(300))).toBe('hard')
  })
})

describe('Turkish suffixes', () => {
  it('matches a suffixed noun, which a trailing word boundary would miss', () => {
    expect(estimateTaskDifficulty('bana bir uygulaması yap')).toBe('hard')
    expect(classifyTaskCategory('şu kodu düzelt')).toBe('code')
    expect(classifyTaskCategory('bir görseli büyüt')).toBe('image')
  })

  it('reads "yazılım" as code, not as prose writing', () => {
    expect(classifyTaskCategory('yazılım geliştir')).toBe('code')
  })
})

// Turkish typed without its diacritics is the common case in chat, not an edge case: if these fall
// through to 'general', category routing and MCP tool budgeting both switch themselves off.
describe('diacritic-free Turkish', () => {
  it('classifies the same as the accented spelling', () => {
    expect(classifyTaskCategory('elektro gitar fiyatlarini arastir')).toBe('research')
    expect(classifyTaskCategory('bana bir logo ciz')).toBe('image')
    expect(classifyTaskCategory('su fonksiyonu duzelt')).toBe('code')
    expect(classifyTaskCategory('yazilim gelistir')).toBe('code')
    expect(classifyTaskCategory('bu maili daha kibar yaz')).toBe('writing')
  })

  it('estimates the same difficulty as the accented spelling', () => {
    expect(estimateTaskDifficulty('sifirdan bir sistem mimarisi kur')).toBe('hard')
    expect(estimateTaskDifficulty('bu cumleyi cevir')).toBe('easy')
  })

  it('still leaves small talk alone', () => {
    expect(classifyTaskCategory('naber')).toBe('general')
  })

  it('folds a capitalised dotted I, which lowercasing alone would leave with a combining dot', () => {
    expect(classifyTaskCategory('İNCELE bu kütüphaneyi')).toBe('research')
  })
})

// The app's whole reason to exist: "make me an app". These named no keyword before and fell to
// 'general', so the heaviest request in the product got the lightest routing.
describe('build-a-thing requests', () => {
  it('routes them to code', () => {
    expect(classifyTaskCategory('bana bir todo uygulamasi yap')).toBe('code')
    expect(classifyTaskCategory('bir web sitesi yap')).toBe('code')
    expect(classifyTaskCategory('sifirdan bir sistem mimarisi kur')).toBe('code')
    expect(classifyTaskCategory('bu projeyi ayaga kaldir')).toBe('code')
    expect(classifyTaskCategory('build me a dashboard app')).toBe('code')
  })

  it('and rates them hard, so they claim the strongest model', () => {
    expect(estimateTaskDifficulty('bana bir todo uygulamasi yap')).toBe('hard')
  })

  it('still lets an image request win, since the output shape decides the model', () => {
    expect(classifyTaskCategory('uygulama icin bir logo ciz')).toBe('image')
  })

  it('does not swallow plain prose that happens to mention a site', () => {
    expect(classifyTaskCategory('bu maili daha kibar yaz')).toBe('writing')
    expect(classifyTaskCategory('su sitedeki yazilari ozetle')).not.toBe('code')
  })
})
