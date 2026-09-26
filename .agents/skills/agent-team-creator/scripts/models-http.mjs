export function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    return value;
}
export function text(value, label) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${label} must be a nonempty string`);
    return value;
}
export function assertNoCredentials(value) {
    const encoded = JSON.stringify(value);
    for (const [name, secret] of Object.entries(process.env)) {
        if (/(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)$/i.test(name) && secret && secret.length >= 8 && encoded.includes(JSON.stringify(secret).slice(1, -1))) {
            throw new Error('credential values must not be persisted; use environment references');
        }
    }
    function inspect(item) {
        if (Array.isArray(item)) {
            item.forEach(inspect);
            return;
        }
        if (item && typeof item === 'object')
            for (const [key, child] of Object.entries(item)) {
                if (/^(?:authorization|api_?key|access_?token|refresh_?token|password|secret|private_?key)$/i.test(key)) {
                    throw new Error('credential fields are not accepted in persisted content');
                }
                inspect(child);
            }
    }
    inspect(value);
}
export function endpoint(value) {
    const url = new URL(text(value, 'endpoint URL'));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new Error('endpoint must be HTTP(S), without userinfo or fragment');
    }
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new Error('non-loopback endpoints require HTTPS');
    }
    for (const key of url.searchParams.keys()) {
        if (/(?:token|key|secret|password|credential|auth)/i.test(key))
            throw new Error('URL credentials are forbidden; use auth.env');
    }
    assertNoCredentials(url.href);
    return url;
}
export class RequestFailure extends Error {
    code;
    uncertain;
    httpStatus;
    constructor(code, uncertain, httpStatus = null) {
        super(code);
        this.code = code;
        this.uncertain = uncertain;
        this.httpStatus = httpStatus;
    }
}
// Response bodies and raw fetch errors are never returned: either can echo credentials.
export async function requestJson(url, input, method = 'GET', body, extraHeaders = {}) {
    const headers = { Accept: 'application/json', ...extraHeaders };
    let secret;
    if (input.auth !== undefined) {
        const auth = object(input.auth, 'auth');
        if (Object.keys(auth).some(key => !['env', 'header', 'scheme'].includes(key)))
            throw new RequestFailure('invalid_auth_configuration', false);
        const name = text(auth.env, 'auth.env');
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
            throw new RequestFailure('invalid_auth_environment_reference', false);
        secret = process.env[name];
        if (!secret)
            throw new RequestFailure('credential_environment_unavailable', false);
        if (/[\r\n]/.test(secret))
            throw new RequestFailure('invalid_credential_environment_value', false);
        const header = auth.header ?? 'Authorization';
        if (header !== 'Authorization' && header !== 'X-API-Key')
            throw new RequestFailure('invalid_auth_header', false);
        const scheme = auth.scheme ?? (header === 'Authorization' ? 'Bearer' : 'raw');
        if (scheme !== 'Bearer' && scheme !== 'raw')
            throw new RequestFailure('invalid_auth_scheme', false);
        headers[header] = scheme === 'Bearer' ? `Bearer ${secret}` : secret;
    }
    const timeout = input.timeoutMs ?? 10000;
    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 60000)
        throw new RequestFailure('invalid_timeout_configuration', false);
    if (body !== undefined)
        headers['Content-Type'] = 'application/json';
    let response;
    try {
        response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeout) });
    }
    catch {
        throw new RequestFailure('transport_unavailable_or_redirect_refused', method !== 'GET');
    }
    if (!response.ok) {
        await response.body?.cancel();
        throw new RequestFailure('http_request_failed', method !== 'GET' && response.status >= 500, response.status);
    }
    try {
        const reader = response.body?.getReader();
        if (!reader)
            throw new Error('empty');
        const chunks = [];
        let length = 0;
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            length += part.value.length;
            if (length > 8 * 1024 * 1024) {
                await reader.cancel();
                throw new Error('large');
            }
            chunks.push(part.value);
        }
        const encoded = Buffer.concat(chunks).toString('utf8');
        if (secret && encoded.includes(secret))
            throw new Error('credential reflected');
        return { value: JSON.parse(encoded), status: response.status };
    }
    catch {
        throw new RequestFailure('invalid_or_unsafe_json_response', method !== 'GET', response.status);
    }
}
