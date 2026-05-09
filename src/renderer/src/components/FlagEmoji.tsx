import { isWin } from '@renderer/config/constant'
import cnSvg from 'flag-icons/flags/4x3/cn.svg?url'
import deSvg from 'flag-icons/flags/4x3/de.svg?url'
import esSvg from 'flag-icons/flags/4x3/es.svg?url'
import frSvg from 'flag-icons/flags/4x3/fr.svg?url'
import gbSvg from 'flag-icons/flags/4x3/gb.svg?url'
import grSvg from 'flag-icons/flags/4x3/gr.svg?url'
import hkSvg from 'flag-icons/flags/4x3/hk.svg?url'
import idSvg from 'flag-icons/flags/4x3/id.svg?url'
import itSvg from 'flag-icons/flags/4x3/it.svg?url'
import jpSvg from 'flag-icons/flags/4x3/jp.svg?url'
import krSvg from 'flag-icons/flags/4x3/kr.svg?url'
import mySvg from 'flag-icons/flags/4x3/my.svg?url'
import nlSvg from 'flag-icons/flags/4x3/nl.svg?url'
import pkSvg from 'flag-icons/flags/4x3/pk.svg?url'
import plSvg from 'flag-icons/flags/4x3/pl.svg?url'
import ptSvg from 'flag-icons/flags/4x3/pt.svg?url'
import roSvg from 'flag-icons/flags/4x3/ro.svg?url'
import ruSvg from 'flag-icons/flags/4x3/ru.svg?url'
import saSvg from 'flag-icons/flags/4x3/sa.svg?url'
import skSvg from 'flag-icons/flags/4x3/sk.svg?url'
import thSvg from 'flag-icons/flags/4x3/th.svg?url'
import trSvg from 'flag-icons/flags/4x3/tr.svg?url'
import uaSvg from 'flag-icons/flags/4x3/ua.svg?url'
import usSvg from 'flag-icons/flags/4x3/us.svg?url'
import vnSvg from 'flag-icons/flags/4x3/vn.svg?url'
import { type CSSProperties, memo } from 'react'

const FLAG_SVG_MAP: Record<string, string> = {
  cn: cnSvg,
  de: deSvg,
  es: esSvg,
  fr: frSvg,
  gb: gbSvg,
  gr: grSvg,
  hk: hkSvg,
  id: idSvg,
  it: itSvg,
  jp: jpSvg,
  kr: krSvg,
  my: mySvg,
  nl: nlSvg,
  pk: pkSvg,
  pl: plSvg,
  pt: ptSvg,
  ro: roSvg,
  ru: ruSvg,
  sa: saSvg,
  sk: skSvg,
  th: thSvg,
  tr: trSvg,
  ua: uaSvg,
  us: usSvg,
  vn: vnSvg
}

function emojiToCountryCode(emoji: string): string {
  return [...emoji]
    .map((c) => c.codePointAt(0)!)
    .filter((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff)
    .map((cp) => String.fromCharCode(cp - 0x1f1e6 + 97))
    .join('')
}

interface FlagEmojiProps {
  emoji: string
  size?: number
  style?: CSSProperties
}

const FlagEmoji = memo(({ emoji, size = 16, style }: FlagEmojiProps) => {
  if (!isWin) {
    return (
      <span className="country-flag-font" style={style}>
        {emoji}
      </span>
    )
  }

  const code = emojiToCountryCode(emoji)
  const svgUrl = FLAG_SVG_MAP[code]

  if (!svgUrl) {
    return (
      <span className="country-flag-font" style={style}>
        {emoji}
      </span>
    )
  }

  return (
    <img
      src={svgUrl}
      alt={emoji}
      style={{
        width: size,
        height: size * 0.75,
        verticalAlign: 'middle',
        ...style
      }}
    />
  )
})

FlagEmoji.displayName = 'FlagEmoji'

export default FlagEmoji
