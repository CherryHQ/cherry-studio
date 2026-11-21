#!/usr/bin/env bash
# Regenerates corpus-cases.json (the CommonMark conformance corpus consumed by
# conformance-sweep.test.ts in this directory and by conformanceStream.test.ts
# in src/main/ai/runtime/claudeCode/__tests__).
#
# Source: the CommonMark 0.31.2 specification examples.
#   curl -L https://spec.commonmark.org/0.31.2/spec.json -o /tmp/spec-0.31.2.json
# The CommonMark specification is by John MacFarlane and the CommonMark
# authors, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
# Each case embeds a synthetic <analysis>PROBE_*</analysis> wrapper tag at a
# probe position derived from the example's markdown, so the corpus exercises
# scratchpad-stripping decisions against real CommonMark block structure.
set -euo pipefail
python3 <<'PYEOF'
import json, re, html

spec = json.load(open('/tmp/spec-0.31.2.json'))
SECTIONS = {'Indented code blocks','Fenced code blocks','Block quotes','Lists','List items','Tabs','HTML blocks','Paragraphs','Precedence'}

def expand_tabs(s):
    out, col = [], 0
    for ch in s:
        if ch == '\t':
            n = 4 - (col % 4)
            out.append(' ' * n); col += n
        else:
            out.append(ch); col += 1
    return ''.join(out)

def strip_container(line):
    # remove blockquote/list markers and leading indent for content matching
    s = expand_tabs(line)
    changed = True
    while changed:
        changed = False
        m = re.match(r'^ {0,3}> ?', s)
        if m: s = s[m.end():]; changed = True; continue
        m = re.match(r'^ {0,3}(?:[-*+]|\d{1,9}[.)]) +', s)
        if m: s = s[m.end():]; changed = True; continue
    return s.lstrip(' ')

code_re = re.compile(r'<pre><code(?: [^>]*)?>(.*?)</code></pre>', re.S)
fence_re = re.compile(r'^ {0,3}(`{3,}|~{3,})')
tag_start_re = re.compile(r'^\s*</?[a-zA-Z!/]')
setext_re = re.compile(r'^\s*(=+|-+)\s*$')
thematic_re = re.compile(r'^\s{0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$')
linkdef_re = re.compile(r'^\s{0,3}\[[^\]]*\]:')

cases = []
skipped = {'opaque': 0, 'unclassified': 0}
for ex in spec:
    if ex['section'] not in SECTIONS: continue
    md, expected = ex['markdown'], ex['html']
    if '<!--' in md or '<![CDATA[' in md or '<?' in md:
        skipped['opaque'] += 1; continue
    code_blobs = [html.unescape(b) for b in code_re.findall(expected)]
    plain_html = html.unescape(re.sub(r'<[^>]+>', ' ', expected))
    plain_html_norm = re.sub(r'\s+', ' ', plain_html)
    lines = md.split('\n')
    in_fence = None  # (char, len)
    probes = []
    for idx, line in enumerate(lines):
        if line.strip() == '': continue
        exp_line = expand_tabs(line)
        if in_fence:
            m = fence_re.match(exp_line)
            if m and m.group(1)[0] == in_fence[0] and len(m.group(1)) >= in_fence[1]:
                in_fence = None
                continue
            # fence content line: literal
            if not re.search(r'analysis|thinking|summary', line, re.I):
                probes.append((idx, 'preserve'))
            continue
        m = fence_re.match(exp_line)
        if m:
            in_fence = (m.group(1)[0], len(m.group(1)))
            continue
        content = strip_container(line)
        if not content: continue
        if tag_start_re.match(line) or setext_re.match(content) or thematic_re.match(content) or linkdef_re.match(line):
            continue
        if re.search(r'analysis|thinking|summary', line, re.I): continue
        if line.count('`') % 2 == 1: continue
        norm = re.sub(r'\s+', ' ', content).strip()
        if not norm: continue
        in_code = any(norm in re.sub(r'\s+', ' ', b) for b in code_blobs)
        if in_code:
            probes.append((idx, 'preserve'))
        elif norm in plain_html_norm:
            probes.append((idx, 'strip'))
    # pick first preserve and first strip probe
    chosen, kinds = [], set()
    for idx, kind in probes:
        if kind not in kinds:
            kinds.add(kind); chosen.append((idx, kind))
    for idx, kind in chosen:
        pid = f"ex{ex['example']}{'C' if kind=='preserve' else 'S'}"
        new_lines = list(lines)
        new_lines[idx] = new_lines[idx] + f' <analysis>PROBE_{pid}</analysis>'
        cases.append({'id': pid, 'section': ex['section'], 'expect': kind,
                      'input': '\n'.join(new_lines)})

json.dump(cases, open('/tmp/corpus-cases.json','w'))
from collections import Counter
print('generated:', len(cases), Counter((c['section'], c['expect']) for c in cases))
print('skipped:', skipped)
PYEOF