# SEO Content Audit Skill — Remaining Enhancements Design

**Date:** 2026-02-26
**Status:** Approved
**Implementation Order:** 1 → 4 → 2 → 3 → 5

## Feature 1: Playwright-Based Crawling (--render)

**Approach:** Hybrid auto-detect with optional Playwright dependency.

### Design

- `playwright` is an **optional** dependency — not in `requirements.txt`
- New file: `scripts/crawl_render.py` — isolated rendering logic
- `crawl.py` gains `--render` flag and `render=` kwarg on `crawl_url()`
- Auto-detect flow: if `validate_crawl_quality()` returns `is_js_rendered=True`, warn and offer re-crawl with rendering
- `crawl_render.py` exports `crawl_url_rendered(url, timeout=30)` using Playwright sync API
- Browser: Chromium only (smallest), headless mode
- Setup: `pip install playwright && playwright install chromium`
- Graceful fallback: if Playwright not installed and `--render` requested, print install instructions and exit 1

### API

```python
# crawl_render.py
def crawl_url_rendered(url, timeout=30, wait_until="networkidle") -> dict:
    """Same return format as crawl_url() but uses headless browser."""

def is_playwright_available() -> bool:
    """Check if playwright + chromium are installed."""
```

```python
# crawl.py changes
def crawl_url(url, ..., render=False) -> dict:
    # If render=True, delegate to crawl_render.crawl_url_rendered()
    # If render="auto", crawl normally then check quality
```

### CLI

```bash
python crawl.py URL --render          # Force rendered crawl
python crawl.py URL --render auto     # Normal crawl, auto-retry if JS detected
python crawl.py URL                   # Unchanged default behavior
```

---

## Feature 4: Per-Category Recommendations

**Approach:** Static rule engine inside each scorer, recommendations field on CategoryScore.

### Design

- Add `recommendations: list[str]` field to `CategoryScore` dataclass in `base.py`
- Each scorer appends actionable recommendation strings based on sub-score thresholds
- Recommendations are specific and actionable (not generic advice)
- Priority levels embedded in text: `[CRITICAL]`, `[HIGH]`, `[MEDIUM]`, `[LOW]`
- `scoring_engine.py` aggregates all recommendations into output, sorted by priority
- `build_report.py` renders recommendations in the action plan section

### Rule Pattern

```python
# Inside each scorer's score() method:
if title_keyword_score < 50:
    recs.append("[HIGH] Move target keyword to the first 3 words of the title tag")
if word_count < threshold * 0.7:
    recs.append(f"[CRITICAL] Add {int(threshold - word_count)} more words — content is {int((1 - word_count/threshold)*100)}% below competitor average")
```

### Output

```json
{
  "categories": {
    "onpage_seo": {
      "score": 62.5,
      "recommendations": [
        "[HIGH] Move target keyword to the first 3 words of the title tag",
        "[MEDIUM] Add FAQ schema markup — 60% of competitors have it"
      ]
    }
  },
  "all_recommendations": [
    {"priority": "critical", "category": "content_quality", "text": "..."},
    {"priority": "high", "category": "onpage_seo", "text": "..."}
  ]
}
```

---

## Feature 2: SerpAPI/Serper.dev Integration

**Approach:** Generic provider interface with Serper.dev as default third-party option.

### Design

- New function `search_serper(keyword, num_results, api_key)` in `serp_scraper.py`
- ENV: `SERPER_API_KEY` for Serper.dev
- Fallback hierarchy becomes: Google CSE → Serper.dev → Direct scrape → Manual
- `SERP_PROVIDER` env var to force a specific provider (optional)
- Same return format as existing providers

### API

```python
def search_serper(keyword, num_results=5, language="en", country="us", api_key=None) -> tuple[dict|None, str|None]:
    """Serper.dev Google SERP API. Returns (results_dict, error_string)."""
```

### Serper.dev API

```
POST https://google.serper.dev/search
Headers: X-API-KEY: <key>
Body: {"q": keyword, "num": num_results, "gl": country, "hl": language}
Response: {"organic": [{"title", "link", "snippet", "position"}]}
```

---

## Feature 3: Score Trend Tracking

**Approach:** Output-directory JSONL history with `--compare` flag.

### Design

- History file: `$OUT/score_history.jsonl` (one JSON object per line)
- After scoring, append current run to history automatically
- `--compare` flag on `scoring_engine.py` loads history and computes deltas
- Trend data added to scores output under `"trend"` key
- Shows: score delta, grade change, per-category deltas, improved/declined categories

### Output

```json
{
  "trend": {
    "previous_score": 59.2,
    "current_score": 72.1,
    "delta": +12.9,
    "previous_grade": "C-",
    "current_grade": "C+",
    "runs_compared": 2,
    "category_deltas": {
      "entity_semantic": {"previous": null, "current": 55.3, "delta": null},
      "content_quality": {"previous": 79.1, "current": 75.0, "delta": -4.1}
    },
    "improved": ["entity_semantic", "rag_retrieval"],
    "declined": ["content_quality"],
    "unchanged": ["technical_seo"]
  }
}
```

---

## Feature 5: Confidence Intervals

**Approach:** Simple data-completeness-based margin.

### Design

- Formula: `margin = (1 - data_completeness) * 15`
- Added to `compute_final_score()` output in `grade_bands.py`
- Output: `confidence: {margin, low, high, level}`
- Level: "high" (margin < 3), "medium" (3-8), "low" (> 8)

### Output

```json
{
  "final_score": 72.1,
  "confidence": {
    "margin": 2.25,
    "low": 69.85,
    "high": 74.35,
    "level": "high",
    "note": "85% data completeness — score is reliable"
  }
}
```
