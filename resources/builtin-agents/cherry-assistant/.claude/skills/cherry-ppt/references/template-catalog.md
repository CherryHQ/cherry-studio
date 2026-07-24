# Cherry-PPT Template Catalog

## Template Selection

| ID | Style | Best for | Agenda limit |
| --- | --- | --- | ---: |
| `red` | 正式红白 | 通用汇报、方案、组织协作、品牌正式表达 | 4 |
| `enterprise-blue` | 正式蓝白 | 企业汇报、技术方案、流程说明、理性表达 | 4 |
| `young` | 年轻糖果 3D | 产品发布、校园分享、创意提案、轻快场景 | 5 |
| `cy2k` | 深色玻璃霓虹 | 数字未来、创新报告、技术提案、品牌展示 | 5 |

All templates are 16:9 and preserve their native PowerPoint Master and Layout hierarchy. The current generator supports the five shared layouts below. Do not request a source layout outside this list.

| Layout | Purpose |
| --- | --- |
| `cover` | Title, subtitle, author, and date |
| `agenda` | Four or five agenda entries |
| `section` | Chapter number and title; optional subtitle on `young` and `cy2k` only. CY2K uses a one-character chapter number. |
| `content` | Page title and one to three concise points |
| `closing` | Closing title, subtitle, and contact |

## JSON Contract

Write one strict JSON object. Unknown fields are rejected.

```json
{
  "template": "enterprise-blue",
  "slides": [
    {
      "layout": "cover",
      "title": "Quarterly Review",
      "subtitle": "Decisions and next steps",
      "author": "Strategy Team",
      "date": "2026 / 07"
    },
    {
      "layout": "agenda",
      "items": [
        { "title": "Results", "description": "What changed" },
        { "title": "Priorities", "description": "What comes next" }
      ]
    },
    {
      "layout": "section",
      "number": "01",
      "title": "Results",
      "subtitle": ""
    },
    {
      "layout": "content",
      "section": "RESULTS",
      "title": "Adoption increased across core teams",
      "points": [
        { "label": "01", "title": "Reach", "body": "Active teams increased by 18%." },
        { "label": "02", "title": "Depth", "body": "Repeat workflows grew to 3.4 per user." }
      ],
      "takeaway": "Standardized workflows drove repeat use.",
      "source": "Source: Internal analytics, Q2 2026",
      "pageNumber": "04 / 05"
    },
    {
      "layout": "closing",
      "title": "Thank you",
      "subtitle": "Questions and discussion",
      "contact": "team@example.com"
    }
  ]
}
```

## Copy Limits

Keep copy shorter than the visual capacity below. The exporter performs a weighted CJK/Latin check and identifies the exact field when content is too long.

- Cover: on `red`, `enterprise-blue`, and `young`, keep the title to about 6 CJK characters (or `Cherry-PPT`) and the subtitle to about 8. CY2K supports about 9 CJK characters in its title.
- Section: use `01`-style numbers on `red`, `enterprise-blue`, and `young`; use one character such as `1` on CY2K. Keep titles to about 11 CJK characters on the light templates and 8 on CY2K.
- Agenda: formal templates support about 14 CJK characters in a title and 13 in a description. On `young` and `cy2k`, the combined title and description must stay within about 15 CJK characters.
- Content: keep page titles to about 9 CJK characters on `red`, `enterprise-blue`, and `young`; CY2K supports about 19. Body copy may wrap inside its content region but must still pass the exporter check.
- Closing: keep titles to about 9 CJK characters on the light templates and 5 on CY2K. Keep subtitles and contact lines concise.

When a field is rejected, shorten the wording or split the idea across another content slide. Do not silently delete facts, reduce font sizes, or overlay new text boxes.
