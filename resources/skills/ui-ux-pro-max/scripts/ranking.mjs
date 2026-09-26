// Calibrated BM25 and abstention, ported from the pinned MIT upstream.
import { config, tokenize, normalize, contains, similarity, project } from './data.mjs';
export const noThreshold = { min_score: 0, min_coverage: 0, min_margin: 0 };
export const stackThreshold = { min_score: 3.6, min_coverage: 1 / 3, min_margin: 0 };
export const threshold = (domain) => ({ min_score: { style: 4.3, landing: 4, product: 6, icons: 5.8, react: 3.3 }[domain] ?? 0, min_coverage: domain === 'landing' ? 0.5 : 0, min_margin: 0 });
export class BM25 {
    frequencies = [];
    docFreqs = new Map();
    idf = new Map();
    lengths = [];
    average = 1;
    constructor(documents) {
        for (const document of documents) {
            const tokens = tokenize(document);
            this.lengths.push(tokens.length);
            const tf = new Map();
            for (const token of tokens)
                tf.set(token, (tf.get(token) ?? 0) + 1);
            this.frequencies.push(tf);
            for (const token of tf.keys())
                this.docFreqs.set(token, (this.docFreqs.get(token) ?? 0) + 1);
        }
        this.average = this.lengths.reduce((a, b) => a + b, 0) / documents.length || 1;
        for (const [term, freq] of this.docFreqs)
            this.idf.set(term, Math.log((documents.length - freq + 0.5) / (freq + 0.5) + 1));
    }
    score(query) { const tokens = tokenize(query); return this.frequencies.map((tf, i) => [i, tokens.reduce((sum, t) => { const f = tf.get(t) ?? 0; return sum + (this.idf.get(t) ?? 0) * f * 2.5 / (f + 1.5 * (0.25 + 0.75 * this.lengths[i] / this.average)); }, 0)]).sort((a, b) => b[1] - a[1]); }
    coverage(query) { const tokens = [...new Set(tokenize(query))]; return tokens.length ? tokens.filter(t => this.idf.has(t)).length / tokens.length : 0; }
}
export function passes(index, query, t) { const score = index.score(query); return (score[0]?.[1] ?? 0) > t.min_score && index.coverage(query) >= t.min_coverage && (!t.min_margin || (score[0]?.[1] ?? 0) - (score[1]?.[1] ?? 0) >= t.min_margin); }
export function suggest(index, query, t) { if (!index)
    return []; const tokens = [...new Set(tokenize(query))]; if (!tokens.length)
    return []; return [...index.idf.keys()].filter(term => !tokens.includes(term)).map(term => ({ term, score: Math.max(...tokens.map(token => similarity(token, term))), freq: index.docFreqs.get(term) ?? 0 })).filter(x => x.score >= 0.72 && passes(index, x.term, t)).sort((a, b) => b.score - a.score || b.freq - a.freq || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0)).slice(0, 6).map(x => x.term); }
export function exactDiagnostic(query, reason = 'exact-identity') { return { normalized_query: normalize(query), search_query: query, query_rewrites: [], top_score: 0, runner_up_score: 0, margin: 0, token_coverage: 1, abstained: false, calibration_version: '2026-08-12-v1', reason }; }
export function rankedSearch(data, searchCols, outputCols, query, max, t = noThreshold, domain) {
    if (!data.length)
        return { results: [], index: null, diagnostic: { reason: 'empty-data' } };
    const index = new BM25(data.map(row => searchCols.map(c => row[c] ?? '').join(' ')));
    const rewrites = [];
    const replacements = [];
    const normalized = normalize(query.toLowerCase());
    for (const keyword of config.domainKeywords[domain ?? ''] ?? []) {
        if (!contains(normalized, keyword) || tokenize(keyword).some(t => index.idf.has(t)))
            continue;
        const replacement = config.domainRewrites[domain ?? '']?.[keyword];
        if (replacement) {
            rewrites.push(`${keyword}->${replacement}`);
            replacements.push(replacement);
        }
    }
    const searchQuery = replacements.length ? `${query} ${[...new Set(replacements)].sort().join(' ')}` : query;
    const ranked = index.score(searchQuery), top = ranked[0]?.[1] ?? 0, runner = ranked[1]?.[1] ?? 0, coverage = index.coverage(searchQuery);
    const abstained = top <= t.min_score || coverage < t.min_coverage || (t.min_margin > 0 && top - runner < t.min_margin);
    return { results: abstained ? [] : ranked.slice(0, max).filter(([, score]) => score > 0).map(([i]) => project(data[i], outputCols)), index, diagnostic: { normalized_query: normalize(query), search_query: searchQuery, query_rewrites: [...new Set(rewrites)].sort(), top_score: top, runner_up_score: runner, margin: top - runner, token_coverage: coverage, abstained, calibration_version: '2026-08-12-v1', reason: abstained ? 'low-confidence' : 'matched' } };
}
