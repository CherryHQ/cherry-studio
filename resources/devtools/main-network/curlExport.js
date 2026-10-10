const CURL_BODY_FRAMING_HEADERS = new Set(['content-length', 'transfer-encoding', 'content-encoding'])

function shellQuoteSingle(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function curlComment(text) {
  return `# ${String(text).replace(/\r?\n/g, ' ')}`
}

function shouldSkipCurlHeader(name) {
  return CURL_BODY_FRAMING_HEADERS.has(String(name).toLowerCase())
}

function hasReplayableCurlBody(body) {
  return Boolean(body?.text && body.replayable !== false && !body.truncated)
}

function buildCurlCommand(event) {
  const parts = ['curl', shellQuoteSingle(event.url)]
  const method = (event.method || 'GET').toUpperCase()
  const body = event.requestBody
  const includeBody = hasReplayableCurlBody(body)

  if (method === 'HEAD') {
    parts.push('--head')
  } else if (method !== 'GET' || includeBody) {
    parts.push('-X', shellQuoteSingle(method))
  }

  for (const [key, value] of Object.entries(event.requestHeaders ?? {})) {
    if (shouldSkipCurlHeader(key)) continue
    parts.push('-H', shellQuoteSingle(`${key}: ${value}`))
  }

  if (method !== 'HEAD' && includeBody) {
    parts.push('--data-raw', shellQuoteSingle(body.text))
  } else if (body?.truncated) {
    parts.push(curlComment('request body truncated in capture; omit --data-raw for replay'))
  } else if (body?.text && body.replayable === false) {
    parts.push(curlComment('request body is a display summary only; omit --data-raw for replay'))
  } else if (body?.note) {
    parts.push(curlComment(`request body not captured: ${body.note}`))
  }

  return parts.join(' \\\n  ')
}

globalThis.buildCurlCommand = buildCurlCommand
