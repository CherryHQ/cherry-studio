// Adapted from UI/UX Pro Max, MIT. See provenance.json for immutable revision.
import { readFileSync } from 'node:fs';
export const config = JSON.parse(readFileSync(new URL('../data/search-config.json', import.meta.url), 'utf8'));
// RFC 4180 records: quoted newlines, escaped quotes, UTF-8 BOM and CRLF.
export function parseCSV(text) {
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                field += '"';
                i++;
            }
            else
                quoted = !quoted;
        }
        else if (c === ',' && !quoted) {
            record.push(field);
            field = '';
        }
        else if ((c === '\r' || c === '\n') && !quoted) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            record.push(field);
            if (record.some(Boolean))
                records.push(record);
            record = [];
            field = '';
        }
        else
            field += c;
    }
    if (quoted)
        throw new Error('Unclosed CSV quote');
    if (field || record.length) {
        record.push(field);
        records.push(record);
    }
    const headers = records.shift() ?? [];
    return records.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])));
}
export function rows(file) { return parseCSV(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8')); }
export const escapeRE = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function contains(text, phrase) { return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRE(phrase)}(?![\\p{L}\\p{N}_])`, 'u').test(text); }
export function normalize(text) { for (const [variant, canonical] of Object.entries(config.synonyms).sort((a, b) => b[0].length - a[0].length))
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRE(variant)}(?![\\p{L}\\p{N}_])`, 'giu'), canonical); return text; }
const stopwords = new Set(config.stopwords);
export function tokenize(text) { return normalize(text.toLowerCase()).replace(/[^\p{L}\p{N}_\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2 && !stopwords.has(w)); }
export function identities(row, fields) { return fields.flatMap(field => field === 'Aliases' ? (row[field] ?? '').split('|') : [row[field] ?? '']).map(x => x.trim()).filter(Boolean); }
export const project = (row, columns) => Object.fromEntries(columns.filter(c => c in row).map(c => [c, row[c]]));
// SequenceMatcher's longest contiguous matching-block ratio, without junk tokens.
export function similarity(a, b) {
    function matches(alo, ahi, blo, bhi) {
        let best = 0, ai = alo, bi = blo;
        let previous = new Map();
        for (let i = alo; i < ahi; i++) {
            const next = new Map();
            for (let j = blo; j < bhi; j++)
                if (a[i] === b[j]) {
                    const n = (previous.get(j - 1) ?? 0) + 1;
                    next.set(j, n);
                    if (n > best) {
                        best = n;
                        ai = i - n + 1;
                        bi = j - n + 1;
                    }
                }
            previous = next;
        }
        if (!best)
            return 0;
        return best + matches(alo, ai, blo, bi) + matches(ai + best, ahi, bi + best, bhi);
    }
    return a.length + b.length ? 2 * matches(0, a.length, 0, b.length) / (a.length + b.length) : 1;
}
