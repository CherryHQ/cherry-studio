export const PROMPT_SUGGESTION_INSTRUCTION = `[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]

FIRST: Look at the user's recent messages and original request.

Your job is to predict what THEY would type - not what you think they should do.

THE TEST: Would they think "I was just about to type that"?

EXAMPLES:
User asked "fix the bug and run tests", bug is fixed → "run the tests"
After code written → "try it out"
Claude offers options → suggest the one the user would likely pick, based on conversation
Claude asks to continue → "yes" or "go ahead"
Task complete, obvious follow-up → "commit this" or "push it"
After error or misunderstanding → silence (let them assess/correct)

Be specific: "run the tests" beats "continue".

NEVER SUGGEST:
- Evaluative ("looks good", "thanks")
- Questions ("what about...?")
- Claude-voice ("Let me...", "I'll...", "Here's...")
- New ideas they didn't ask about
- Multiple sentences

Stay silent if the next step isn't obvious from what the user said.

Stay silent if a suggestion could be unsafe or inappropriate — including any sensitive topic (security incidents, credentials, harm, private data). Even when the user is doing legitimate security or cybersecurity work, do not predict potentially unsafe actions.

Format: 2-12 words, match the user's style. Or nothing.

Reply with ONLY the suggestion, no quotes or explanation.`

// These rules mirror the documented CLI generator; display safety is a separate boundary.
export function normalizePromptSuggestion(candidate: string): string {
  const text = candidate
    .trim()
    .replace(/^<(suggestion|response|output|answer|result)>([\s\S]*)<\/\1>$/i, (original, tag: string, body: string) =>
      body.toLowerCase().includes(`</${tag.toLowerCase()}>`) ? original : body
    )
    .replace(
      /^\s*(suggested\s+(response|reply|input|prompt)|suggestion|response|reply|answer|output|result|提案|回答|返信|応答|出力|結果|建议|回复|答案|输出|结果|제안|답변|응답|출력|결과)\s*[:：]\s*/i,
      ''
    )
    .trim()

  const lower = text.toLowerCase()
  const words = suggestionWordCount(text)

  const asianCharacters = [...text].filter((char) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30fc\uff70\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
      char
    )
  ).length

  const singleWords = new Set([
    'yes',
    'yeah',
    'yep',
    'yea',
    'yup',
    'sure',
    'ok',
    'okay',
    'push',
    'commit',
    'deploy',
    'stop',
    'continue',
    'check',
    'exit',
    'quit',
    'no'
  ])

  if (!text || text.length >= 100 || words > 12 || /[\r\n*]/.test(text)) return ''

  if (words < 2 && !text.startsWith('/') && (asianCharacters > 0 ? asianCharacters < 2 : !singleWords.has(lower)))
    return ''

  if (lower === 'done' || /^\P{L}*(完了(しました)?|完成了?|완료됨?)\P{L}*$/u.test(text)) return ''

  if (
    /^(nothing found\.?$|nothing to suggest|no suggestion)|\bsilence is\b|\bstay(s|ing)? silent\b|^\W*silence\W*$/.test(
      lower
    ) ||
    /^\P{L}*(沈黙|沉默|静默|침묵|提案(なし|はありません)|特に(なし|ありません)|[无没沒]有?建[议議]|(제안|해당)\s*없음)\P{L}*$/u.test(
      text
    )
  )
    return ''

  if (/^(\(.*\)|\[.*\]|（.*）|［.*］|【.*】|〔.*〕)$/.test(text) || /^\w+:\s/.test(text)) return ''

  if (/^(api error:|prompt is too long|request timed out|invalid api key|image was too large)/.test(lower)) return ''

  if (/[.!?]\s+[A-Z]|[。！？]\s*[\p{L}\p{N}]/u.test(text)) return ''

  if (
    /thanks|thank you|looks good|sounds good|that works|that worked|that's all|nice|great|perfect|makes sense|awesome|excellent/.test(
      lower
    ) ||
    /^\P{L}*(ありがとう(ございます|ございました)?|助かりました|[谢謝][谢謝][你您]?|感[谢謝][你您]?|感謝します|감사합니다|고마워요?)(\P{L}|的|$)/u.test(
      text
    ) ||
    /(良さそう|よさそう|いいですね|看起来不错|太好了|完璧|完美|좋네요)(です|ですね|だね)?\P{L}*$/u.test(text)
  )
    return ''

  if (
    /^(let me|i'll|i've|i'm|i can|i would|i think|i notice|here's|here is|here are|that's|this is|this will|you can|you should|you could|sure,|of course|certainly|让我(?!们)|我来|我会|我将)/i.test(
      text
    )
  )
    return ''

  return text
}

function suggestionWordCount(text: string): number {
  if (!text.trim()) return 0
  let words = 0

  for (const segment of text.trim().split(/\s+/)) {
    let han = 0
    let phonetic = 0
    let other = 0

    for (const character of segment) {
      if (/\p{Script=Han}/u.test(character)) han++
      else if (
        /[\p{Script=Hiragana}\p{Script=Katakana}\u30fc\uff70\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
          character
        )
      )
        phonetic++
      else if (/[\p{L}\p{N}]/u.test(character)) other++
    }

    words += han === 0 && phonetic === 0 ? 1 : (other > 0 ? 1 : 0) + han / 2 + phonetic / 4
  }

  return Math.ceil(words)
}
