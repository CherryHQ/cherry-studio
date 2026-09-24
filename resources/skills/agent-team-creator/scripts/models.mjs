import { assertNoCredentials, endpoint, object, requestJson, text } from './models-http.mjs';
import { policy as validatePolicy } from './validation.mjs';
const tiers = ['low', 'medium', 'hard'];
const own = (record, key) => Object.hasOwn(record, key) ? record[key] : undefined;
const maybeObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numberOrNull = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const stringOrNull = (value) => typeof value === 'string' && value.length > 0 ? value : null;
function freshness(provenance, maxAge) {
    const limit = maxAge ?? 30;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0)
        throw new Error('maxCatalogAgeDays must be nonnegative');
    const fetched = stringOrNull(provenance.fetched);
    const stamp = fetched ? Date.parse(fetched) : NaN;
    const age = Number.isFinite(stamp) ? (Date.now() - stamp) / 86400000 : null;
    return { fetchedAt: fetched, ageDays: age === null ? null : Math.max(0, age), stale: age === null || age < 0 ? null : age > limit, maxAgeDays: limit };
}
function catalogMetadata(input) {
    const catalog = input.catalog === undefined ? {} : object(input.catalog, 'catalog');
    if (input.catalog !== undefined && catalog.$schema_version !== 1)
        throw new Error('liter-llm catalog requires $schema_version 1');
    const original = maybeObject(catalog.$provenance);
    const provenance = {
        source: stringOrNull(original.source), sourceSha256: stringOrNull(original.source_sha256),
        fetched: stringOrNull(original.fetched), libraryVersion: stringOrNull(original.library_version),
        adapter: 'liter-llm/catalog-schema-1', sourceRevision: 'c5c6caac617eb931cd5009146a70831422ec236c',
    };
    return { providers: maybeObject(catalog.providers), provenance, freshness: freshness(provenance, input.maxCatalogAgeDays) };
}
function prices(model) {
    const pricing = maybeObject(model.pricing);
    const rows = [pricing, ...(Array.isArray(pricing.tiers) ? pricing.tiers.map(value => object(value, 'catalog pricing tier')) : [])];
    const max = (key) => {
        const values = rows.map(row => numberOrNull(row[key]));
        const converted = values.some(value => value === null) ? null : Math.max(...values) * 1_000_000;
        return numberOrNull(converted);
    };
    return { inputPerMillion: max('input_cost_per_token'), outputPerMillion: max('output_cost_per_token'), currency: 'USD', basis: 'maximum-known-context-tier', sourceUnit: 'per-token' };
}
function normalize(input, rows, kind, discovery) {
    const metadata = catalogMetadata(input);
    const aliases = input.aliases === undefined ? {} : object(input.aliases, 'aliases');
    const annotations = input.tiers === undefined ? {} : object(input.tiers, 'tiers');
    for (const tier of Object.values(annotations))
        if (typeof tier !== 'string' || !tiers.includes(tier))
            throw new Error('operator tiers must be low, medium or hard');
    const seen = new Set();
    const models = rows.map(value => {
        const row = typeof value === 'string' ? { id: value } : object(value, 'discovered model');
        const id = text(row.id, 'model.id');
        if (seen.has(id))
            throw new Error('duplicate discovered model identifier; narrow discovery to one provider');
        seen.add(id);
        const mapped = own(aliases, id);
        const mapping = mapped === undefined ? null : object(mapped, 'alias mapping');
        const provider = mapping ? text(mapping.provider, 'alias.provider') : null;
        const catalogId = mapping ? text(mapping.model, 'alias.model') : null;
        const providerModels = provider ? maybeObject(maybeObject(own(metadata.providers, provider)).models) : {};
        const catalogModel = catalogId ? own(providerModels, catalogId) : undefined;
        if (mapping && !catalogModel)
            throw new Error('explicit alias mapping does not identify a catalog model');
        const model = maybeObject(catalogModel);
        const capabilities = {};
        for (const [key, flag] of Object.entries(maybeObject(model.capabilities)))
            if (typeof flag === 'boolean')
                capabilities[key] = flag;
        const fields = { supports_tools: 'function_calling', supports_vision: 'vision', supports_streaming: 'streaming', supports_reasoning: 'reasoning', supports_thinking: 'reasoning', supports_structured_output: 'structured_output' };
        if (kind === 'uar' || kind === 'bossfang')
            for (const [field, capability] of Object.entries(fields)) {
                if (typeof row[field] === 'boolean')
                    capabilities[capability] = row[field];
            }
        const pricing = prices(model);
        if (!mapping && kind === 'bossfang') {
            pricing.inputPerMillion = numberOrNull(row.input_cost_per_m);
            pricing.outputPerMillion = numberOrNull(row.output_cost_per_m);
            pricing.sourceUnit = 'per-million-tokens';
            pricing.basis = 'bossfang-configured-base-price';
        }
        const available = kind === 'bossfang' ? (typeof row.available === 'boolean' ? row.available : null)
            : kind === 'uar' ? (typeof row.enabled === 'boolean' ? row.enabled : null) : true;
        return {
            id, provider: provider ?? stringOrNull(row.provider), catalogId, available,
            tier: own(annotations, id) ?? null, capabilities, pricing,
            provenance: { discovery, catalog: mapping ? metadata.provenance : null,
                availabilityBasis: kind === 'declared' ? 'operator-declared' : 'configured-discovery-response',
                metadataBasis: mapping ? 'explicit-alias-mapping' : kind === 'declared' ? 'operator-declared-identifier-only' : kind === 'openai' ? 'identifier-only' : 'configured-native-record' },
            freshness: mapping ? metadata.freshness : { fetchedAt: discovery?.fetchedAt ?? null, ageDays: discovery ? 0 : null, stale: null },
        };
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const result = { schemaVersion: 1, models, catalogProvenance: metadata.provenance, catalogFreshness: metadata.freshness,
        diagnostics: ['Discovery describes configured availability, not a successful inference.', 'Strength tiers are operator annotations; unspecified metadata remains unknown.'] };
    assertNoCredentials(result);
    return result;
}
/** Discover identifiers; catalog aliases are explicit and credentials remain in the environment. */
export async function discoverModels(input) {
    assertNoCredentials(input);
    const kind = input.kind ?? 'openai';
    if (kind !== 'openai' && kind !== 'uar' && kind !== 'bossfang')
        throw new Error('discovery kind must be openai, uar or bossfang');
    let url;
    if (input.discoveryUrl !== undefined)
        url = endpoint(input.discoveryUrl);
    else {
        if (kind !== 'openai')
            throw new Error('UAR and BossFang require an explicit discoveryUrl');
        url = endpoint(input.baseUrl);
        if (url.search)
            throw new Error('baseUrl cannot contain a query');
        url.pathname = `${url.pathname.replace(/\/$/, '').replace(/\/v1$/, '')}/v1/models`;
    }
    const response = await requestJson(url, input);
    const payload = kind === 'uar' ? response.value : object(response.value, 'model discovery response')[kind === 'bossfang' ? 'models' : 'data'];
    if (!Array.isArray(payload))
        throw new Error('model discovery response has an unsupported shape');
    return normalize(input, payload, kind, { kind, url: url.href, fetchedAt: new Date().toISOString(), httpStatus: response.status });
}
/** Layered scalar overrides, AND capabilities, deterministic lowest-known-total-price choice. */
export function selectModel(team, roleId, skills, taskPolicy, catalog) {
    const role = team.roles.find(candidate => candidate.id === roleId);
    if (!role)
        throw new Error('unknown role for model selection');
    const layers = [['team', team.modelPolicy], ['role', role.modelPolicy],
        ...skills.map(skill => [`skill:${skill}`, team.skillPolicies?.[skill]]), ['task', taskPolicy]];
    let policy = {};
    const applied = [];
    for (const [name, layer] of layers)
        if (layer) {
            validatePolicy(layer, `${name}.modelPolicy`);
            const capabilities = [...new Set([...(policy.capabilities ?? []), ...(layer.capabilities ?? [])])];
            policy = { ...policy, ...Object.fromEntries(Object.entries(layer).filter(([, value]) => value !== undefined)), capabilities };
            applied.push(name);
        }
    const input = object(catalog, 'catalog input');
    const normalized = input.schemaVersion === 1 && Array.isArray(input.models) ? input
        : normalize(input, Array.isArray(input.availableModels) ? input.availableModels : [], 'declared', null);
    if (!Array.isArray(normalized.models))
        throw new Error('normalized catalog models must be an array');
    const accepted = [];
    const rejected = [];
    const seen = new Set();
    for (const value of normalized.models) {
        const model = object(value, 'model');
        const id = text(model.id, 'model.id');
        if (seen.has(id))
            throw new Error('duplicate model identifier in selection catalog');
        seen.add(id);
        const reasons = [];
        const capabilities = maybeObject(model.capabilities);
        const pricing = maybeObject(model.pricing);
        if (model.available !== true)
            reasons.push('availability unknown or disabled');
        if (policy.model && model.id !== policy.model)
            reasons.push('different explicit model');
        if (policy.tier && model.tier !== policy.tier)
            reasons.push('declared tier missing or different');
        for (const capability of policy.capabilities ?? [])
            if (capabilities[capability] !== true)
                reasons.push(`capability ${capability} unsupported or unknown`);
        const ceilings = [[policy.maxInputPerMillion, pricing.inputPerMillion], [policy.maxOutputPerMillion, pricing.outputPerMillion]];
        for (const [ceiling, price] of ceilings) {
            if (ceiling === undefined)
                continue;
            const known = numberOrNull(price);
            if (known === null)
                reasons.push('price unknown; cannot satisfy ceiling');
            else if (known > ceiling)
                reasons.push('price exceeds ceiling');
        }
        if (reasons.length)
            rejected.push({ id: model.id, reasons });
        else
            accepted.push(model);
    }
    const totalPrice = (model) => {
        const pricing = maybeObject(model.pricing);
        const input = numberOrNull(pricing.inputPerMillion), output = numberOrNull(pricing.outputPerMillion);
        return input === null || output === null ? Infinity : input + output;
    };
    accepted.sort((a, b) => (totalPrice(a) - totalPrice(b)) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    const selected = accepted[0] ?? null;
    const warnings = [];
    if (selected) {
        const age = maybeObject(selected.freshness);
        if (age.stale === true)
            warnings.push('Selected catalog pricing is stale. Price ceilings do not guarantee current provider rates.');
        else if (age.stale === null || age.stale === undefined)
            warnings.push('Selected pricing freshness is unknown. Price ceilings do not guarantee current provider rates.');
        const provenance = maybeObject(selected.provenance);
        if (provenance.availabilityBasis === 'operator-declared')
            warnings.push('Availability is operator-declared; no live discovery was performed for this list.');
    }
    const result = { selected, policy: policy, appliedLayers: applied, rejected,
        explanation: selected ? 'All declared constraints satisfied; ordered by lowest known input+output USD per million, then exact identifier. Unknown costs rank last.' : 'No declared available model satisfies every constraint.',
        warnings, diagnostics: normalized.diagnostics ?? [], catalogProvenance: normalized.catalogProvenance ?? null, catalogFreshness: normalized.catalogFreshness ?? null };
    assertNoCredentials(result);
    return result;
}
