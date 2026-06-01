# FlipForge — Project State
*Update this file at the end of every session. Upload alongside CLAUDE.md at the start of every session.*

---

## Last Updated
2026-06-01

---

## 1. Current Phase & Progress

**Current phase:** Offer Gap visual QA complete across all three states. Backend verdict gate fix merged and confirmed live. Product is investor-grade and ready for demo decision.

**Current product state:**
- Input credibility: Repair Budget Builder visible in all three flows (Draft Deal, Resume Deal, Legacy Manual Analyze).
- Output credibility: Result screen calls out whether user is over/near/under Max Safe Offer. "Why this verdict" uses backend notes. Screen reads like an investor decision memo, not a generic dashboard.

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
- [x] Repair Budget Builder — src/components/RepairBudgetBuilder.tsx (PR #39, frontend-only; Legacy flow wired in PR #41)
  - 9 repair categories with None/Light/Medium/Heavy levels
  - Bathroom count stepper, sqft-based flooring
  - Low/Mid/High estimates + contingency selector
  - "Use Mid as Rehab Budget" writes into rehab_budget field
  - Available in Draft Deal / Resume Deal flows (PR #39)
  - Available in Legacy Manual Analyze flow (PR #41 — was a documentation/session-note error from PR #39, not a regression)
- [x] Result screen deal-memo polish — src/AnalysisResult.tsx (PR #40, frontend-only)
  - Offer Gap callout: Overpay Risk (red) / Offer Gap (amber) / Offer Cushion (green)
    comparing meta.purchase_price vs result.max_safe_offer
  - Callout renders in all flows including Legacy Manual Analyze
    (pdfMeta.purchase_price is populated from purchasePrice state even without a draft)
  - "Why this verdict" now uses backend result.notes as primary bullets
  - Optional breakpoint context if deal is fragile
  - Optional first stress-test downgrade line
  - Removed redundant Notes subsection (was showing same content as notes)
  - Live QA confirmed: Offer Cushion state renders correctly in Legacy Manual Analyze flow
- [x] RepairBudgetBuilder wired into Legacy Manual Analyze (PR #41, src/App.tsx only)
  - PR #39 session notes incorrectly claimed Legacy flow was wired — it was not
  - PR #40 (AnalysisResult.tsx) was not involved — not a regression
  - Fix: one line added inside {showLegacy && ...} after 4-field input grid, wired to setRehabBudget
  - Live QA confirmed: RepairBudgetBuilder visible in Manual Analyze Legacy
  - Live QA confirmed: result screen still renders after Analyze Deal
- [x] Verdict gate fix — backend PR #11 (merged, live), app/analysis_engine.py only
  - overall_verdict hard-fails to PASS when net_profit <= 0 AND purchase_price > max_safe_offer
  - Fixes live QA mismatch: negative-profit overpay deal was showing CONDITIONAL while notes said PASS
  - No frontend changes, no schema/model/route changes, no BRRRR scoring redesign
  - Individual strategy verdicts unchanged
- [x] Offer Gap visual QA — all three states confirmed in production (2026-06-01)
  - Red Overpay Risk ✅ (purchase_price 220000 / ARV 300000 / rehab 50000 — after PR #11 fix)
  - Amber Tight Offer ✅ (purchase_price 176000 / ARV 300000 / rehab 50000)
  - Green Offer Cushion ✅ (purchase_price 160000 / ARV 300000 / rehab 50000)

### Not Done
- [ ] Make strongest deal-killer / stress-test breakpoint more headline-level
- [ ] Improve copyable investor summary (future polish)
- [ ] PDF lender report — future monetizable wedge, do not start yet
- [ ] Tighten CORS from * to https://flipforge-frontend.vercel.app
- [ ] Add minimal GitHub Actions CI
  - Backend: import/startup check for FastAPI app
  - Frontend: TypeScript + build check (tsc --noEmit && vite build)
  - Goal: catch import/type errors before manual PR review
  - Not urgent, but should be done soon
- [ ] Do NOT start AIM / cars / furniture / non-real-estate expansion yet

### Next Session Goal
Offer Gap QA is complete. Decide whether the product is ready for a soft demo to hard-money lenders / investors, or whether one small polish pass is needed first.
After that decision: make the strongest deal-killer / stress-test breakpoint more headline-level.

---

## 2. Repos

| Repo | GitHub | Deployed |
|------|--------|----------|
| Frontend | Gurmindersingh27/flipforge-frontend | https://flipforge-frontend.vercel.app |
| Backend | Gurmindersingh27/flipforge-backend | https://flipforge-backend.onrender.com |

No active dev branch. Work on named feature branches; never push to main directly.

---

## 3. What This App Does

FlipForge is a risk-first real estate deal underwriting tool for serious investors. The investor enters (or pastes a listing URL for) a property and gets:
- Net profit, ROI, profit margin
- Flip / BRRRR / Wholesale scores and verdicts (BUY / CONDITIONAL / PASS)
- Max Safe Offer (MAO)
- Offer Gap callout comparing offer vs MAO (Overpay Risk / Offer Gap / Offer Cushion) — renders in all flows
- Repair Budget Builder — line-item rehab estimator, available in all flows
- Rehab Reality classification (LIGHT / MEDIUM / HEAVY / EXTREME)
- Stress test scenarios (ARV -5%, ARV -10%, Rehab +15%, Hold +2mo)
- Risk flags with severity levels
- Breakpoints (first stress scenario that kills the deal)
- Confidence score (0-100)
- "Why this verdict" rationale (backend notes + stress context)
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
- `build_notes()` — produces 2–3 human-readable rationale strings surfaced in frontend "Why this verdict"

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
  AnalysisResult.tsx          ← Deal analysis results display (Offer Gap callout, verdict rationale)
  components/
    ShieldHeader.tsx          ← Header component
    RepairBudgetBuilder.tsx   ← Repair budget estimator (PR #39+#41, all three flows)
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
b2d2307  docs: update PROJECT_STATE and CLAUDE.md after PR #41 merge
3a2b600  fix: show repair budget builder in legacy manual analyzer (#41)
07654861  feat: result screen deal-memo polish — offer gap callout + verdict rationale (#40)
a46dda8   Merge pull request #39 — feat: add Repair Budget Builder
c5809c2   fix: add ProviderStatus type and cache metadata fields to EnrichAddressResponse (#38)
0c2a97a   Hide Legacy Manual Analyze section by default
b744b2a   feat: deal page clarity — max offer, remove duplicate buttons, fix allowed_outputs
18fe47e   feat: saved deals page clarity
07fb928   feat: results page clarity polish
9616d4e   feat: polish Resume UX — conditional header and specific validation messaging
22d97b0   Fix hardcoded API_BASE in AnalysisResult.tsx
ad39f86   Fix meta bridge + lender report + address override
e307963   Restore UI styles
23826a4   FlipForge frontend MVP
```

**Backend:**
```
1aec418  docs: session closeout 2026-06-01 — verdict gate fix (backend PR #11)
2a6d8b0  fix: hard-fail overall_verdict to PASS when net_profit <= 0 and purchase_price > max_safe_offer (#11)
036f36e  docs: session closeout 2026-05-10 — deal-memo polish (frontend-only)
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
- Offer Gap callout renders in Legacy Manual Analyze flow (pdfMeta.purchase_price is populated
  from the purchasePrice state default even without a draft). PR #40 description claiming it was
  a "silent no-op" in legacy path was incorrect. Live QA confirmed it renders there.

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

## Session 2026-05-10 — Repair Budget Builder

**Branch:** `claude/review-flipforge-docs-YN2Ye`
**PR:** #39 (merged, commit a46dda8)
**Changed file:** `src/components/RepairBudgetBuilder.tsx` (new), `src/App.tsx` (+1 import, +1 JSX element)

**Feature:**
- Self-contained repair cost estimator component
- 9 repair categories: roof, HVAC, electrical, plumbing, kitchen, bathrooms, flooring, windows, paint/misc
- Severity levels: None / Light / Medium / Heavy per category
- Bathroom count stepper (1–4); sqft input for flooring (per-sqft pricing)
- Contingency selector: None / 10% / 15% / 20% of subtotal
- Displays Low / Mid / High estimates per category and totals
- "Use Mid as Rehab Budget" applies rounded mid to existing rehab_budget field
- Collapsed by default; expand via "Build Repair Budget →" link
- Disclaimer: SE US contractor pricing, 2026, planning tool only

**Documentation error (corrected in PR #41):**
Session notes for PR #39 incorrectly claimed RepairBudgetBuilder was available in "Legacy Manual Analyze flow."
The actual PR #39 diff shows it was only added inside `{draft && ...}` (Draft Deal / Resume Deal).
Legacy flow was wired in PR #41 — not a regression from PR #40.

**Guardrails confirmed:**
- No backend changes, no AnalyzeRequest changes, no types.ts changes, no analysis_engine.py changes

---

## Session 2026-05-10 — Result screen deal-memo polish

**Branch:** `claude/deal-decision-memo`
**PR:** #40 (merged)
**Merge commit:** `07654861`
**Changed file:** `src/AnalysisResult.tsx` only

**Features shipped:**

1. **Offer Gap callout** — new section between Key Numbers card and Verdict card
   - Compares `meta.purchase_price` (passed from App.tsx `pdfMeta`) vs `result.max_safe_offer`
   - Three states:
     - Overpay Risk (red): `purchase_price > max_safe_offer`
       - ≥ $15k over: "limited room for ARV or rehab misses"
       - < $15k over: "leaves little margin for error"
     - Offer Gap (amber): within $5k under max_safe_offer
     - Offer Cushion (green): more than $5k under max_safe_offer
   - Renders in all flows — pdfMeta.purchase_price is populated from purchasePrice state even
     in legacy flow (defaults to 120000). PR #40 description claiming "silent no-op in legacy
     path" was incorrect. Live QA confirmed Offer Cushion renders correctly in Legacy flow.

2. **Verdict rationale** — "Why this verdict" section rebuilt
   - `result.notes` (from backend `build_notes()`) used as primary bullets — human-readable, already specific
   - Falls back to generic bullet only if `notes` is empty
   - Optional: appends breakpoint context if `bp.is_fragile && bp.first_break_scenario`
   - Optional: appends first stress-test downgrade if any scenario worsens base verdict
   - Dead `verdictReason` lookup removed (field never populated by backend `AnalyzeResponse`)

3. **Notes subsection removed** — the only deleted UI block
   - Old `{result.notes?.length > 0 && <div>Notes…</div>}` subsection removed
   - Notes content now lives in "Why this verdict" above; subsection was redundant
   - `space-y-5` removed from narrative card only because the subsection was removed

**New helpers (module-level):**
- `verdictRank(v: string): number` — BUY=2, CONDITIONAL=1, PASS=0
- `buildOfferGapCallout(purchasePrice, mao)` — returns colored JSX section or null

**Guardrails confirmed:**
- `analysis_engine.py` untouched
- `AnalyzeRequest` untouched
- No backend changes
- No schema changes
- No `api.ts` / `types.ts` changes
- No RentCast calls

**Build/deploy:** Vercel auto-deploy triggered on main merge (commit 07654861).
TypeScript verified clean by source review (no local runner in this session environment).

---

## Session 2026-05-11 — Wire RepairBudgetBuilder into Legacy Manual Analyze

**Branch:** `claude/legacy-rehab-builder`
**PR:** #41 (merged)
**Merge commit:** `3a2b600`
**Changed file:** `src/App.tsx` only

**Issue diagnosed:** RepairBudgetBuilder was not visible in Manual Analyze Legacy flow on live app.

**Root cause:** Documentation/session-note error from PR #39. PR #39's actual diff shows only two lines
added to App.tsx: the import, and `<RepairBudgetBuilder>` inside `{draft && ...}` only. The Legacy
`{showLegacy && ...}` section was never touched. PR #40 (AnalysisResult.tsx only) was not involved
— this was not a regression.

**Fix:** One line added to `src/App.tsx` inside `{showLegacy && (...)}` block:
```tsx
<RepairBudgetBuilder onApply={(mid) => setRehabBudget(mid)} />
```
Placed after the 4-field input grid, before `{FinancingAssumptions}`, wired to existing `setRehabBudget`.

**Live QA confirmed:**
- RepairBudgetBuilder is visible in Manual Analyze Legacy
- Result screen still renders correctly after Analyze Deal

**Guardrails confirmed:**
- No backend changes
- No schema changes
- No analysis_engine.py changes
- No api.ts / types.ts changes
- No AnalysisResult.tsx changes
- No RepairBudgetBuilder.tsx changes
- Draft/Resume flow unchanged
- Stale branch `claude/review-flipforge-docs-Sdr3P` was NOT merged
- No RentCast calls

---

## Session 2026-06-01 — Offer Gap visual QA closeout

**QA completed in production. All three Offer Gap states confirmed.**

**Backend change required (PR #11, merged and live):**
- `app/analysis_engine.py` only — `overall_verdict` hard-fails to PASS when `net_profit <= 0` AND `purchase_price > max_safe_offer`
- No frontend changes, no schema/model/route changes, no BRRRR scoring redesign
- Individual strategy verdicts (`flip_verdict`, `brrrr_verdict`, `wholesale_verdict`) unchanged

**QA results:**

1. **Red Overpay Risk** ✅
   - Input: purchase_price 220000 / ARV 300000 / rehab 50000 / rent 1800 / holding 6 / interest 12% / LTC 90%
   - Initial run exposed verdict mismatch: `overall_verdict = CONDITIONAL` while notes said "PASS unless terms change"
   - Root cause: BRRRR score (59) clears CONDITIONAL threshold via rent-to-cost boost; no net_profit gate existed
   - Backend PR #11 added hard gate in `analyze_deal()`
   - Retest passed: top verdict PASS ✅, red Overpay Risk card rendered ✅, narrative agrees ✅, Integrity Gate suppresses Lender Report and Negotiation Script ✅

2. **Amber Tight Offer** ✅
   - Input: purchase_price 176000 / ARV 300000 / rehab 50000 / rent 1800 / holding 6 / interest 12% / LTC 90%
   - Offer Gap card shown in amber ✅
   - Message: within ~$2,200 of Max Safe Offer; deal may work only if ARV and rehab assumptions hold ✅

3. **Green Offer Cushion** ✅
   - Input: purchase_price 160000 / ARV 300000 / rehab 50000 / rent 1800 / holding 6 / interest 12% / LTC 90%
   - Offer Cushion card shown in green ✅
   - Message: ~$18,200 under Max Safe Offer ✅
   - Lender Report and Negotiation Script remain available ✅
