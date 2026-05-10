# FlipForge — Project State
*Update this file at the end of every session. Upload alongside CLAUDE.md at the start of every session.*

---

## Last Updated
2026-05-10

---

## 1. Current Phase & Progress

**Current phase:** UX polish shipped across Resume, Results, Saved Deals, and Deal page. Legacy analyzer hidden. Ready for first real user.

### Done
- [x] Backend Day 1 complete — DraftDeal, DataPoint/Confidence models built
- [x] `/api/draft-from-url` working
- [x] `/api/finalize-and-analyze` working (stress tests, breakpoints, rehab_reality, narratives)
- [x] NarrativeGenerator fixed — accepts base metrics
- [x] Frontend MVP exists — App.tsx, AnalysisResult.tsx, api.ts, types.ts all in place
- [x] CLAUDE.md added to both repos
- [x] PROJECT_STATE.md added to both repos
- [x] Backend audited — requirements.txt clean, all 5 routes present, start command correct
- [x] Render backend deployed successfully
- [x] Live backend URL confirmed: https://flipforge-backend.onrender.com
- [x] GET /api/health confirmed live and returning {"status":"ok"}
- [x] Frontend deployed on Vercel: https://flipforge-frontend.vercel.app
- [x] VITE_API_BASE_URL set to live Render URL on Vercel
- [x] POST /api/analyze confirmed working in prod
- [x] POST /api/export/lender-report confirmed returning application/pdf in prod
- [x] Full frontend → backend → PDF pipeline validated end-to-end
- [x] Draft Deal editor: assumption fields (holding_months, annual_interest_rate, loan_to_cost_pct) exposed as editable inputs
- [x] Draft Deal editor: extraction notes (draft.notes, draft.signals) displayed in panel
- [x] View Saved Deal — /deal/:id (read-only)
  - User clicks saved deal from dashboard
  - Navigates to /deal/:id
  - Fetches saved deal via GET /api/deals/{id}
  - Renders draft_input summary + analysis_result
  - Read-only view (no analyzer rehydration)
- [x] Saved deal page — Lender Report and Negotiation Script disabled, labeled "Soon", no API calls for any verdict type
- [x] Resume UX polish
  - Conditional header label ("Resumed Deal" vs "Draft from URL")
  - Specific 422 missing-field messaging with field names
  - Assumption input highlighting on validation error
- [x] Results page clarity
  - max_safe_offer rendered
  - confidence_score rendered
  - Risk flags rendered
  - Integrity Gate moved lower in results
  - Integrity Gate copy fixed
- [x] Saved Deals page clarity
  - max_safe_offer column added
  - Verdict badges added
  - Resume action added
  - Compare action removed
- [x] Deal page clarity
  - max_safe_offer added to header snapshot
  - Duplicate disabled buttons removed
  - allowed_outputs pass-through fixed with fallback
- [x] Legacy Manual Analyze hidden by default behind subtle toggle link
- [x] RentCast address lookup cache — ProviderStatus type + cache metadata fields added to types.ts (PR #38, mirrors backend PR #10)
- [x] Repair Budget Builder — frontend-only MVP (PR #39)
  - Available in: Draft Deal flow, Resume Deal flow, Manual Analyze Legacy flow
  - 9 categories: Kitchen, Bathrooms, Flooring, Paint/Drywall, Roof, HVAC, Electrical, Plumbing, Windows/Exterior
  - Bathroom count stepper (1–4); sqft input for flooring (per-sqft rates)
  - Percentage-based contingency selector (None / 10% / 15% / 20% of subtotal)
  - Displays Low / Mid / High estimates per category + totals
  - "Use Mid as Rehab Budget" writes into existing rehab_budget field
  - Existing rehab_budget input remains manually editable after applying
  - No backend changes, no AnalyzeRequest changes, no types.ts/api.ts changes

### Not Done
- [ ] Tighten CORS from * to https://flipforge-frontend.vercel.app
- [ ] Add minimal GitHub Actions CI
  - Backend: import/startup check for FastAPI app
  - Frontend: TypeScript + build check (tsc --noEmit && vite build)
  - Goal: catch import/type errors before manual PR review
  - Not urgent, but should be done soon

### Next Session Goal
Result screen deal-memo polish (planning only — not built yet).

Potential items:
- Make Max Safe Offer the dominant result
- Add "Why this deal fails" / "What kills this deal" section
- Show overpay risk clearly
- Show stress-test breakpoint more clearly
- Improve copyable investor summary

---

## 2. Repos

| Repo | GitHub | Deployed |
|------|--------|----------|
| Frontend | Gurmindersingh27/flipforge-frontend | https://flipforge-frontend.vercel.app |
| Backend | Gurmindersingh27/flipforge-backend | https://flipforge-backend.onrender.com |

Active dev branch (frontend): none — PR #39 merged to main on 2026-05-10
Never push to `main` or `master` directly.

---

## 3. What This App Does

FlipForge is a risk-first real estate deal underwriting tool for serious investors. The investor enters (or pastes a listing URL for) a property and gets:
- Net profit, ROI, profit margin
- Flip / BRRRR / Wholesale scores and verdicts (BUY / CONDITIONAL / PASS)
- Max Safe Offer (MAO)
- Rehab Reality classification (LIGHT / MEDIUM / HEAVY / EXTREME)
- Stress test scenarios (ARV -5%, ARV -10%, Rehab +15%, Hold +2mo)
- Risk flags with severity levels
- Breakpoints (first stress scenario that kills the deal)
- Confidence score (0-100)
- Lender report PDF export

---

## 4. Backend (Python / FastAPI)

**Stack:** FastAPI 0.115 / Uvicorn / Pydantic v2 / httpx / BeautifulSoup4 / ReportLab
**Entry point:** `app/main.py` (NOT root `main.py` — that is an older v1 setup)
**Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
**Deploy:** Render.com (`render.yaml` present in repo)
**Live URL:** https://flipforge-backend.onrender.com

### Dependencies (requirements.txt)
```
fastapi==0.115.0
uvicorn==0.32.0
pydantic==2.10.0
httpx==0.28.0
beautifulsoup4==4.12.3
reportlab==4.2.5
```

### File Structure
```
app/
  main.py                      ← FastAPI app + ALL active routes (use this)
  models.py                    ← ALL Pydantic models (canonical — sync with types.ts)
  analysis_engine.py           ← Core deal math (ACTIVE engine — do not rewrite)
  core/
    analysis_engine.py         ← Duplicate/older — verify which is imported before editing
    config.py                  ← Dead code — not imported by app/main.py, do not activate
    scoring.py
  services/
    url_service.py             ← Scrapes listing URLs → DraftDeal
    pdf_service.py             ← Generates lender report PDF (ReportLab)
    rentcast_service.py        ← RentCast enrichment + SQLite cache (30-day TTL, provider_status contract)
    analyze_service.py
    deal_service.py
    scenario_service.py
  schemas/                     ← analysis, deal, investor_profile, scenario
  api/
    deals.py
    v1/analyze.py, deals.py, profile.py, scenarios.py
  db/                          ← SQLite models (deal, user, analysis, scenario, investor_profile, rentcast_cache)
main.py                        ← Root entry — older v1 router setup, NOT active
render.yaml
requirements.txt
```

### Active API Endpoints
```
GET  /api/health                   ← ✅ confirmed live in prod
POST /api/analyze                  ← AnalyzeRequest → AnalyzeResponse (SCHEMA FROZEN)
POST /api/draft-from-url           ← { url } → DraftFromUrlResponse
POST /api/finalize-and-analyze     ← DraftDeal → AnalyzeResponse (422 if fields missing)
POST /api/export/lender-report     ← LenderReportRequest → PDF bytes
POST /api/enrich-address           ← { address } → EnrichAddressResponse (SQLite cache, 30d TTL)
                                      provider_status: cache_hit | live_success | quota_exhausted | provider_unavailable
```

### Analysis Engine Logic (analysis_engine.py)
- `compute_base_metrics()` — all core financials
- `compute_max_safe_offer()` — binary search for max purchase price at required margin
- `compute_flip/brrrr/wholesale_score()` — scoring per strategy
- `build_stress_tests()` — 5 scenarios: Base, ARV-5%, ARV-10%, Rehab+15%, Hold+2mo
- `compute_rehab_reality()` — ratio thresholds: <20% LIGHT, 20-40% MEDIUM, 40-60% HEAVY, >=60% EXTREME
- `compute_breakpoints()` — finds first stress scenario that fails
- `compute_confidence_score()` — weighted: margin strength (45%), stress robustness (30%), risk penalty (25%)
- Verdict thresholds: score >= 75 = BUY, >= 55 = CONDITIONAL, else PASS

### URL Scraping (url_service.py)
- httpx fetch with browser User-Agent
- Extraction priority: OG price tags → JSON-LD structured data → regex on body text
- Returns SOURCE_BLOCKED on 403/429 (Zillow/Redfin block this — known, not a bug)
- ARV and rehab_budget are ALWAYS missing — investor must fill manually
- Only purchase_price can realistically be scraped

### PDF Export (pdf_service.py)
- Uses ReportLab (pure Python, no system deps)
- Sections: Header, Property Summary, Deal Overview, Financial Assumptions, Analysis Output, Rehab Reality, Risk Notes, Exit Strategy
- Color coded verdicts: BUY=green, CONDITIONAL=amber, PASS=red
- ⚠️ Production risk: must use in-memory bytes (StreamingResponse), no disk writes

---

## 5. Frontend (React / TypeScript / Vite)

**Stack:** React 19 / TypeScript ~5.9 / Vite 7 / No UI library / Vanilla CSS

### File Structure
```
src/
  main.tsx                    ← App entry point
  App.tsx                     ← Root component
  App.css / index.css         ← Global styles
  config.ts                   ← API_BASE_URL (keep separate from api.ts — do not merge)
  shield.ts                   ← Shield logic
  AnalysisResult.tsx          ← Deal analysis results display
  components/
    ShieldHeader.tsx          ← Header component
  lib/
    api.ts                    ← ALL fetch calls to backend
    types.ts                  ← ALL TypeScript types (canonical contract)
  assets/
    react.svg
```

### API Config
- Reads env var: `VITE_API_BASE_URL`
- Fallback (dev): `http://127.0.0.1:8000`
- `config.ts` and `api.ts` are intentionally separate — do not consolidate

### API Functions (api.ts)
- `analyzeDeal(payload)` → `POST /api/analyze`
- `draftFromUrl(url)` → `POST /api/draft-from-url`
- `finalizeAndAnalyze(draft)` → `POST /api/finalize-and-analyze` (handles 422 missing_fields)
- PDF export call — check App.tsx / AnalysisResult.tsx for usage

### NPM Scripts
```
npm run dev       # Vite dev server (http://localhost:5173)
npm run build     # tsc + vite build
npm run lint      # ESLint
npm run preview   # Preview production build
```

---

## 6. Shared Data Contract

Any change must be made in BOTH `src/lib/types.ts` (frontend) AND `app/models.py` (backend) in the same session.

| Type | Frontend | Backend |
|------|----------|---------|
| `AnalyzeRequest` | ✅ | ✅ |
| `AnalyzeResponse` | ✅ | ✅ |
| `DraftDeal` | ✅ | ✅ |
| `DraftFromUrlResponse` | ✅ | ✅ |
| `DataPoint<T>` | ✅ | ✅ |
| `RehabReality` | ✅ | ✅ |
| `Breakpoints` | ✅ | ✅ |
| `RiskFlag` | ✅ | ✅ |
| `StressTestScenario` | ✅ | ✅ |
| `Verdict` | `"BUY"\|"CONDITIONAL"\|"PASS"` | same |
| `Strategy` | `"flip"\|"brrrr"\|"wholesale"` | same |
| `Confidence` | `"HIGH"\|"MEDIUM"\|"LOW"\|"MISSING"` | same |
| `RehabSeverity` | `"LIGHT"\|"MEDIUM"\|"HEAVY"\|"EXTREME"` | same |
| `ProviderStatus` | `"cache_hit"\|"live_success"\|"quota_exhausted"\|"provider_unavailable"` | same |

**AnalyzeRequest schema is frozen. Do not modify it.**

---

## 7. Commit History

**Frontend:**
```
a46dda8  feat: add Repair Budget Builder (#39) — merge commit
897e802  fix: add RepairBudgetBuilder to Manual Analyze (Legacy) flow
ae8f358  feat: add repair budget builder
c5809c2  fix: add ProviderStatus type and cache metadata fields to EnrichAddressResponse (#38)
0c2a97a  Hide Legacy Manual Analyze section by default
b744b2a  feat: deal page clarity — max offer, remove duplicate buttons, fix allowed_outputs
18fe47e  feat: saved deals page clarity
07fb928  feat: results page clarity polish
9616d4e  feat: polish Resume UX — conditional header and specific validation messaging
3747221  Merge pull request #4 from Gurmindersingh27/claude/build-draft-editor-ui-xm2tq
d9c5699  docs: correct PROJECT_STATE.md — remove completed items from Not Done
c3ca8c1  Update package-lock.json after npm install
4870de8  Update PROJECT_STATE.md: draft editor assumption fields + UX debt note
998a88f  Draft editor: expose assumption fields + extraction notes
3760c23  Fix lender report endpoint: resolve hardcoded localhost and wrong URL
22d97b0  Fix hardcoded API_BASE in AnalysisResult.tsx
ad39f86  Fix meta bridge + lender report + address override
e307963  Restore UI styles
23826a4  FlipForge frontend MVP
```

**Backend:**
```
196502b  fix: add RentCast cache and provider status handling (#10)
fa30d10  fix(pdf): render None percentage fields as '—' instead of 'None%'
741c4c2  FlipForge backend MVP
```

---

## 8. Known Issues

- Root `main.py` (backend) is an older v1 router setup — active app is `app/main.py`
- `app/core/analysis_engine.py` exists alongside `app/analysis_engine.py` — confirm which is imported before editing either
- `app/core/config.py` imports pydantic-settings but is dead code — not in active import chain, do not add pydantic-settings to requirements.txt
- CORS is wide open (`*`) — needs tightening to Vercel domain before production hardening
- No auth system yet
- Database models exist (SQLite/SQLAlchemy) but may not be wired into active routes
- Zillow/Redfin block URL scraping (SOURCE_BLOCKED) — known limitation, not a bug
- PDF generation must use in-memory bytes in production — disk writes will fail on Render
- Render free tier cold starts — first request after inactivity may take 50+ seconds
- No GitHub Actions CI — import/type errors are only caught at review time

---

## 9. How to Start a New Session

1. Open claude.ai in any browser
2. Start a new Claude Code session
3. Upload both `CLAUDE.md` and `PROJECT_STATE.md`
4. Say exactly:

```
Read CLAUDE.md and PROJECT_STATE.md completely before doing anything.

Then clone both repos:
https://github.com/Gurmindersingh27/flipforge-frontend
https://github.com/Gurmindersingh27/flipforge-backend

Confirm:
1. Both repos are loaded
2. Which branch each repo is on
3. That you can read and modify files in both

Do not make any code changes yet.
```

5. Wait for confirmation, then give one goal.

---

## Session 2026-05-09 — Finalize & Analyze button visibility fixed

**Verified in production:**
- Finalize & Analyze button is bright gold and visible.
- Resume Deal flow shows the correct gold CTA.
- Diagnostic panel is removed from production.
- Legacy manual analyzer button is still gray/dark; separate cosmetic cleanup only, not part of this bug.

**Root cause:**
- src/index.css still had Vite scaffold global button styles:
  button { background-color: #1a1a1a; ... }
- Tailwind v4 utilities are emitted inside cascade layers.
- The un-layered global button rule overrode Tailwind utility classes like bg-[#E8C547].
- Result: enabled button kept dark Vite background while text-slate-900 applied, causing dark text on dark background.

**Diagnostic method:**
- Temporary runtime panel showed:
  canFinalize=true
  analyzeLoading=false
  btn.disabled=false
  computed backgroundColor=rgb(26,26,26)
- That proved it was a CSS cascade issue, not disabled logic or RentCast data.

**Fixes merged:**
- PR #34: Coerced RentCast ARV/rent estimates to Number in enrichResponseToDraft.
- PR #36: Removed global Vite button/button:hover/button:focus rules from src/index.css.
- PR #37: Removed accidentally merged diagnostic panel.

**Important note:**
- RentCast quota was exhausted during debugging. Do not run more live /api/enrich-address tests unless explicitly approved.
- Future task: add caching/rate-limit protection for RentCast lookups.

---

## Session 2026-05-10 — RentCast caching / quota protection (types)

**Changes:** `src/lib/types.ts` only. No behavior changes, no UI changes.

- Added `ProviderStatus` union type: `"cache_hit" | "live_success" | "quota_exhausted" | "provider_unavailable"`
- Added optional fields to `EnrichAddressResponse`: `from_cache`, `cached_at`, `provider_status`, `provider_error`
- All new fields optional — existing call sites unaffected

**Quota note:**
RentCast quota is currently exhausted. Do not run live `/api/enrich-address` tests without explicit approval.

**Deploy:** Vercel auto-deploy triggered on main merge (commit c5809c2)

---

## Session 2026-05-10 — Repair Budget Builder MVP

**Goal:** Give users a credible way to estimate rehab costs instead of guessing.

**Implementation (frontend-only, PR #39):**
- New `src/components/RepairBudgetBuilder.tsx` — self-contained, 277 lines, no external state
- 9 repair categories with None / Light / Medium / Heavy levels
- Bathroom count stepper (1–4) multiplies per-bathroom ranges
- Sqft input for flooring — per-sqft rates; shows $0 + note if sqft not entered
- Contingency selector: None (0%) / Light (10%) / Medium (15%) / Heavy (20%) of subtotal
- Line-item Low / Mid / High per category + subtotal + contingency row + final total
- "Use Mid as Rehab Budget" applies Math.round(totalMid) to existing rehab_budget field
- Existing rehab_budget input remains manually editable after applying
- Collapsed by default; "Build Repair Budget →" link expands it
- Disclaimer: SE US contractor pricing, 2026, planning tool only

**Available in all three flows:**
- Draft Deal (Address / URL) — below field grid, above Assumptions
- Resume Deal — same draft editor, no separate placement needed
- Manual Analyze (Legacy) — below legacy input grid, above Financing Assumptions

**App.tsx changes:** +1 import line, +2 JSX insertions (draft flow + legacy flow), no other changes

**Guardrails confirmed:**
- analysis_engine.py — untouched
- AnalyzeRequest — untouched
- types.ts — untouched
- api.ts — untouched
- No backend changes
- Build: tsc -b && vite build → ✓ 108 modules, 0 TypeScript errors

**Deploy:** Vercel auto-deploy triggered on main merge (commit a46dda8)
