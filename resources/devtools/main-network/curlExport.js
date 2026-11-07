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

function getHeaderValue(headers, name) {
  const normalizedName = String(name).toLowerCase()
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (String(key).toLowerCase() === normalizedName) return value
  }
  return undefined
}

function hasReplayableCurlBody(body) {
  return body?.text !== undefined && !String(body.text).includes('\0') && body.replayable !== false && !body.truncated
}

function buildCurlCommand(event) {
  if (event.requestReplayError) return curlComment(event.requestReplayError)
  const parts = ['curl', '--globoff', shellQuoteSingle(event.url)]
  const method = (event.method || 'GET').toUpperCase()
  const body = event.requestBody
  const includeBody = hasReplayableCurlBody(body)

  if (method === 'HEAD') {
    parts.push('--head')
  } else if (method !== 'GET' || includeBody) {
    parts.push('-X', shellQuoteSingle(method))
  }

  const requestHeaders = event.requestHeaders ?? {}
  for (const [key, value] of event.requestHeaderEntries ?? Object.entries(requestHeaders)) {
    // Preserve a finalized Node zero-length request, but never reuse stale lengths
    // for captured payloads or omitted bodies.
    const verifiedEmptyLength =
      String(key).toLowerCase() === 'content-length' && String(value) === '0' &&
      Array.isArray(event.requestHeaderEntries) && body === undefined
    if (shouldSkipCurlHeader(key) && !verifiedEmptyLength) continue
    parts.push('-H', shellQuoteSingle(value === '' ? `${key};` : `${key}: ${value}`))
  }

  if (includeBody && getHeaderValue(requestHeaders, 'content-type') === undefined) {
    const effectiveType = body?.contentType
    if (effectiveType) {
      parts.push('-H', shellQuoteSingle(`Content-Type: ${effectiveType}`))
    } else {
      parts.push('-H', shellQuoteSingle('Content-Type:'))
    }
  }

  if (method !== 'HEAD' && includeBody) {
    parts.push('--data-raw', shellQuoteSingle(body.text))
  } else if (body?.text?.includes('\0')) {
    parts.push(curlComment('NUL bytes cannot be represented in a shell argument; omit --data-raw for replay'))
  } else if (body?.truncated) {
    parts.push(curlComment('request body truncated in capture; omit --data-raw for replay'))
  } else if (body?.text && body.replayable === false) {
    parts.push(
      curlComment(
        body.note ?? 'request body is a display summary only; omit --data-raw for replay'
      )
    )
  } else if (body?.note) {
    parts.push(curlComment(`request body not captured: ${body.note}`))
  }

  const command = parts.join(' \\\n  ')
  return event.requestReplayWarning ? `${curlComment(event.requestReplayWarning)}\n${command}` : command
}

globalThis.buildCurlCommand = buildCurlCommand
