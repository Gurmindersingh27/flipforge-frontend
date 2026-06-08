# FlipForge — Project State
*Update this file at the end of every session. Upload alongside CLAUDE.md at the start of every session.*

---

## Last Updated
2026-06-08

---

## 1. Current Phase & Progress

**Product direction:** Upload the house. Know the rehab. Know the offer.

**Short pitch:** FlipForge helps real estate investors decide if a property is worth flipping before they waste time, money, or emotion on it. Upload photos, estimate rehab, stress-test the deal, and know your max safe offer before chasing the property.

**Current core loop:**
1. Enter property or deal info.
2. Upload property photos.
3. Photo Rehab Analyzer estimates visible condition and rehab range.
4. User applies mid rehab estimate into the deal.
5. Existing underwriting engine calculates max safe offer, risk, verdict, and investor outputs.
6. User decides whether to offer, negotiate, verify, or walk away.

**Current product state:**
- Photo Rehab Analyzer v1 is built, deployed, and QA-verified in production (backend PR #13, frontend PR #42).
- Live browser QA complete — core loop validated end-to-end in production.
- Live Anthropic vision call confirmed working in production (provider_status: live_success).
- Repair Budget Builder available in all three flows.
- Offer Gap callout, verdict rationale, and stress tests render in all flows.
- Verdict and narrative agree (hard-fail fix from backend PR #11).
- Deal Killer Summary v1 merged (frontend PR #45) — visual QA complete (2026-06-08).

### Done
- [x] Backend Day 1 complete — DraftDeal, DataPoint/Confidence models built
- [x] `/api/draft-from-url` working
- [x] `/api/finalize-and-analyze` working (stress tests, breakpoints, rehab_reality, narratives)
- [x] NarrativeGenerator fixed — accepts base metrics
- [x] Frontend MVP exists — App.tsx, AnalysisResult.tsx, api.ts, types.ts all in place
- [x] CLAUDE.md added to both repos
- [x] PROJECT_STATE.md added to both repos
- [x] Backend audited — requirements.txt clean, all routes present, start command correct
- [x] Render backend deployed successfully
- [x] Live backend URL confirmed: https://flipforge-backend.onrender.com
- [x] GET /api/health confirmed live and returning {"status":"ok"}
- [x] Frontend deployed on Vercel: https://flipforge-frontend.vercel.app
- [x] VITE_API_BASE_URL set to live Render URL on Vercel
- [x] POST /api/analyze confirmed working in prod
- [x] POST /api/export/lender-report confirmed returning application/pdf in prod
- [x] Full frontend → backend → PDF pipeline validated end-to-end
- [x] Draft Deal editor: assumption fields exposed as editable inputs
- [x] Draft Deal editor: extraction notes displayed in panel
- [x] View Saved Deal — /deal/:id (read-only)
- [x] Resume UX polish (conditional header, specific 422 messaging, assumption input highlighting)
- [x] Results page clarity (max_safe_offer, confidence_score, risk flags, Integrity Gate)
- [x] Saved Deals page clarity (max_safe_offer column, verdict badges, Resume action)
- [x] Deal page clarity (max_safe_offer in header, duplicate buttons removed, allowed_outputs fixed)
- [x] Legacy Manual Analyze hidden by default behind subtle toggle link
- [x] RentCast address lookup cache — ProviderStatus type + cache metadata fields added to types.ts (PR #38)
- [x] Repair Budget Builder — src/components/RepairBudgetBuilder.tsx (PR #39, frontend-only)
  - 9 repair categories with None/Light/Medium/Heavy levels
  - Bathroom count stepper, sqft-based flooring
  - Low/Mid/High estimates + contingency selector
  - "Use Mid as Rehab Budget" writes into rehab_budget field
  - Available in Draft Deal / Resume Deal flows (PR #39)
  - Available in Legacy Manual Analyze flow (PR #41)
- [x] Result screen deal-memo polish — src/AnalysisResult.tsx (PR #40, frontend-only)
  - Offer Gap callout (Overpay Risk / Offer Gap / Offer Cushion)
  - "Why this verdict" now driven by backend result.notes
  - Stress-test downgrade context added
- [x] RepairBudgetBuilder wired into Legacy Manual Analyze — frontend PR #41 (commit 3a2b600)
- [x] Verdict hard-fail fix — backend PR #11 (merge commit 14d4dd4)
  - overall_verdict now hard-fails to PASS when net_profit <= 0 AND purchase_price > max_safe_offer
- [x] Offer Gap QA complete — all three callout states verified in production (red/amber/green)
- [x] Photo Rehab Analyzer v1 — backend PR #13 (merge commit f39b1db)
  - New endpoint: POST /api/photo-rehab-analysis (multipart/form-data)
  - Anthropic vision AI identifies condition/severity per room
  - Backend rehab pricing table (rehab_pricing.py) controls all dollar estimates
  - AI never invents dollar amounts — only classifies
  - New models: PhotoRehabAnalysisResponse, RoomFinding, RehabItem, PhotoRehabRiskFlag, PhotoRehabTotals
  - Photos processed in memory only — never stored
  - Validation: 1-8 photos, max 3MB each, JPEG/PNG/WEBP only
  - Totals semantics: subtotal_low/mid/high = before contingency; low/mid/high = after contingency
  - Dev stub available only when PHOTO_REHAB_DEV_STUB=true (NOT set in production)
  - Prod env vars: ANTHROPIC_API_KEY (set, hidden), ANTHROPIC_MODEL=claude-sonnet-4-5
  - analysis_engine.py untouched. AnalyzeRequest unchanged. AnalyzeResponse unchanged.
- [x] Photo Rehab Analyzer v1 — frontend PR #42 (commit 370f5f2)
  - New component: src/components/PhotoRehabAnalyzer.tsx
  - New types: PhotoRehabCondition, PhotoRehabProviderStatus, RoomFinding, RehabItem, PhotoRehabRiskFlag, PhotoRehabTotals, PhotoRehabAnalysisResponse
  - New API function: analyzePhotosForRehab() — multipart/form-data, 120s timeout
  - Client validation: max 8 photos, 3MB each, JPEG/PNG/WEBP only
  - Wired into Draft Deal / Resume flow: onApply → setDraftDpNumber("rehab_budget", v)
  - Wired into Legacy Manual Analyze flow: onApply → setRehabBudget(mid)
  - Placed after RepairBudgetBuilder in both flows
  - formData.append("photos", photo) — field name exactly "photos" (not "photos[]")
  - "Use Mid as Rehab Budget" applies result.totals.mid (post-contingency, not subtotal_mid)
  - provider_status handled: live_success (normal), dev_stub (amber warning), ai_not_configured (red warning), ai_error (red warning)
  - npm run build passes cleanly. No new dependencies.
- [x] Photo Rehab Analyzer live browser QA — COMPLETE (2026-06-04)
- [x] Deal Killer Summary v1 — frontend PR #45 (merged, commits c213c1b + b96c13f)
  - New component: src/components/DealKillerSummary.tsx
  - Renders in src/AnalysisResult.tsx between Offer Gap callout and Verdict card
  - Up to 3 plain-English bullets — priority: overpay, negative profit, thin margin, stress test downgrade, risk flags, low confidence, photo rehab uncertainty
  - Title by verdict: PASS → "What Kills This Deal" / CONDITIONAL → "What Makes This Risky" / BUY → "What Could Still Go Wrong"
  - Returns null on clean BUY with no qualifying issues
  - Uses existing AnalyzeResponse fields only: overall_verdict, max_safe_offer, net_profit, profit_pct, confidence_score, risk_flags, typed_flags, stress_tests, purchase_price via existing meta
  - No backend changes. No schema changes. No App.tsx changes. No analysis_engine.py changes. No RentCast or Anthropic calls.
  - Photo rehab mid threading deferred: PhotoRehabAnalysisResponse state lives inside PhotoRehabAnalyzer.tsx and is not lifted to App.tsx — Priority 7 bullet will not fire until state lift is approved
  - Build passed cleanly (110 modules).
  - Visual QA: COMPLETE (2026-06-08) — see session entry below
  - Manual Analyze Legacy flow: 1 photo uploaded, live_success, estimate displayed, mid applied, Analyze Deal ran successfully
  - Draft/Resume flow: URL draft opened, photo uploaded, live_success, mid applied into draft rehab_budget, Finalize & Analyze ran successfully
  - Invalid upload: PDF blocked at file-picker, 12 photos triggered frontend validation ("Maximum 8 photos. You selected 12.")
  - Oversized file not tested (no >3MB test file available — not a blocker)
  - Core loop validated: upload photo → estimate rehab → apply mid → run underwriting

### Not Done / Blocked
- [ ] Tighten CORS from * to https://flipforge-frontend.vercel.app
  - Note: code in app/main.py is already tightened to Vercel domain; CLAUDE.md docs are stale on this point
- [ ] Add minimal GitHub Actions CI
  - Frontend: TypeScript + build check (tsc --noEmit && vite build)
  - Backend: import/startup check for FastAPI app
  - Not urgent but should be done soon
- [ ] Do NOT start AIM / cars / furniture / non-real-estate expansion

### Next Session Goal
**Investor Action Plan — scope and implement**

- Do not start until PM explicitly approves scope in next session.

---

## 2. Repos

| Repo | GitHub | Deployed |
|------|--------|----------|
| Frontend | Gurmindersingh27/flipforge-frontend | https://flipforge-frontend.vercel.app |
| Backend | Gurmindersingh27/flipforge-backend | https://flipforge-backend.onrender.com |

No active dev branch. Work on named feature branches; never push to main directly.

---

## 3. What This App Does

FlipForge is a risk-first real estate deal underwriting tool for serious investors.

**The core loop:** Upload the house → know the rehab → know the offer.

The investor enters (or pastes a listing URL for) a property, optionally uploads photos for AI rehab estimation, and gets:
- Photo Rehab Analyzer — upload property photos, AI estimates visible rehab scope and cost range
- Net profit, ROI, profit margin
- Flip / BRRRR / Wholesale scores and verdicts (BUY / CONDITIONAL / PASS)
- Max Safe Offer (MAO)
- Offer Gap callout comparing offer vs MAO (Overpay Risk / Offer Gap / Offer Cushion) — renders in all flows
- Repair Budget Builder — manual line-item rehab estimator, available in all flows
- Rehab Reality classification (LIGHT / MEDIUM / HEAVY / EXTREME)
- Stress test scenarios (ARV -5%, ARV -10%, Rehab +15%, Hold +2mo)
- Risk flags with severity levels
- Breakpoints (first stress scenario that kills the deal)
- Confidence score (0-100)
- "Why this verdict" rationale (backend notes + stress context)
- Lender report PDF export

---

## 4. Backend (Python / FastAPI)

**Stack:** FastAPI 0.115 / Uvicorn / Pydantic v2 / httpx / BeautifulSoup4 / ReportLab / anthropic / python-multipart
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
python-multipart>=0.0.9
anthropic>=0.40.0
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
    photo_rehab_service.py     ← Photo rehab analysis (Anthropic vision AI + rehab_pricing.py)
    rehab_pricing.py           ← Controlled SE US contractor pricing constants (flat/per_sqft/per_bath)
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
GET  /api/health                        ← confirmed live in prod
POST /api/analyze                       ← AnalyzeRequest → AnalyzeResponse (SCHEMA FROZEN)
POST /api/draft-from-url                ← { url } → DraftFromUrlResponse
POST /api/finalize-and-analyze          ← DraftDeal → AnalyzeResponse (422 if fields missing)
POST /api/export/lender-report          ← LenderReportRequest → PDF bytes
POST /api/enrich-address                ← { address } → EnrichAddressResponse (SQLite cache, 30d TTL)
                                           provider_status: cache_hit | live_success | quota_exhausted | provider_unavailable
POST /api/photo-rehab-analysis          ← multipart/form-data (photos + optional sqft/region/property_type/user_notes)
                                           → PhotoRehabAnalysisResponse
                                           Validation: 1-8 photos, max 3MB each, JPEG/PNG/WEBP only
                                           provider_status: live_success | ai_not_configured | ai_error | dev_stub
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

### Photo Rehab Analyzer (photo_rehab_service.py + rehab_pricing.py)
- `analyze_photos()` — main entry point, called from /api/photo-rehab-analysis
- Sends base64-encoded images to Anthropic Claude vision model
- AI identifies condition/severity per category — AI never invents dollar amounts
- `rehab_pricing.py` maps severity to controlled dollar ranges (SE US contractor pricing, 2026)
- 9 pricing categories: kitchen, bathrooms, flooring, paint_drywall, roof, hvac, electrical, plumbing, windows_exterior
- Pricing types: flat, per_sqft, per_bath
- Contingency: confidence <50 → 20%, 50-75 → 15%, >75 → 10%
- Totals: subtotal_low/mid/high = pre-contingency; low/mid/high = post-contingency
- Dev stub: activated ONLY when PHOTO_REHAB_DEV_STUB=true — NOT set in production
- Env vars: ANTHROPIC_API_KEY (required for live_success), ANTHROPIC_MODEL (default: claude-sonnet-4-5)

### URL Scraping (url_service.py)
- httpx fetch with browser User-Agent
- Returns SOURCE_BLOCKED on 403/429 (Zillow/Redfin block this — known, not a bug)
- ARV and rehab_budget are ALWAYS missing — investor must fill manually
- Only purchase_price can realistically be scraped

### PDF Export (pdf_service.py)
- Uses ReportLab (pure Python, no system deps)
- ⚠️ Production risk: must use in-memory bytes (StreamingResponse), no disk writes

---

## 5. Frontend (React / TypeScript / Vite)

**Stack:** React 19 / TypeScript ~5.9 / Vite 7 / No UI library / Vanilla CSS

### File Structure
```
src/
  main.tsx                       ← App entry point
  App.tsx                        ← Root component
  App.css / index.css            ← Global styles
  config.ts                      ← API_BASE_URL (keep separate from api.ts — do not merge)
  shield.ts                      ← Shield logic
  AnalysisResult.tsx             ← Deal analysis results display (Offer Gap callout, verdict rationale)
  components/
    ShieldHeader.tsx             ← Header component
    RepairBudgetBuilder.tsx      ← Manual repair budget estimator (PR #39+#41, all three flows)
    PhotoRehabAnalyzer.tsx       ← Photo rehab analyzer (PR #42, all three flows)
    DealKillerSummary.tsx        ← Deal Killer Summary (PR #45, frontend-only)
  lib/
    api.ts                       ← ALL fetch calls to backend
    types.ts                     ← ALL TypeScript types (canonical contract)
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
- `exportLenderReportPdf(payload)` → `POST /api/export/lender-report`
- `generateNegotiationScript(payload)` → `POST /api/generate/negotiation-script`
- `saveDeal(payload, token)` → `POST /api/deals/save`
- `getDeals(token)` → `GET /api/deals`
- `getDeal(id, token)` → `GET /api/deals/:id`
- `enrichAddress(address)` → `POST /api/enrich-address`
- `analyzePhotosForRehab(params)` → `POST /api/photo-rehab-analysis` (multipart/form-data, 120s timeout)

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
| `PhotoRehabCondition` | `"light"\|"medium"\|"heavy"\|"unknown"` | same |
| `PhotoRehabProviderStatus` | `"live_success"\|"ai_not_configured"\|"ai_error"\|"dev_stub"` | same |
| `PhotoRehabAnalysisResponse` | ✅ | ✅ |
| `RoomFinding` | ✅ | ✅ |
| `RehabItem` | ✅ | ✅ |
| `PhotoRehabRiskFlag` | ✅ | ✅ |
| `PhotoRehabTotals` | ✅ | ✅ |

**AnalyzeRequest schema is frozen. Do not modify it.**

---

## 7. Commit History

**Frontend:**
```
b96c13f  chore: replace em dashes with ASCII hyphens in comments (PR #45)
c213c1b  feat: add Deal Killer Summary v1 to result screen (PR #45)
370f5f2  feat: add photo rehab analyzer frontend (PR #42)
cb3444d  docs: session closeout 2026-05-11 — correct known-issues and capture QA results
b2d2307  docs: update PROJECT_STATE and CLAUDE.md after PR #41 merge
3a2b600  fix: show repair budget builder in legacy manual analyzer (#41)
07654861 feat: result screen deal-memo polish — offer gap callout + verdict rationale (#40)
a46dda8  Merge pull request #39 — feat: add Repair Budget Builder
c5809c2  fix: add ProviderStatus type and cache metadata fields to EnrichAddressResponse (#38)
0c2a97a  Hide Legacy Manual Analyze section by default
22d97b0  Fix hardcoded API_BASE in AnalysisResult.tsx
ad39f86  Fix meta bridge + lender report + address override
e307963  Restore UI styles
23826a4  FlipForge frontend MVP
```

**Backend:**
```
f39b1db  Merge pull request #13 — feat: photo rehab analyzer backend v1
14d4dd4  Merge pull request #11 — fix: hard-fail overall_verdict to PASS
196502b  fix: add RentCast cache and provider status handling (#10)
fa30d10  fix(pdf): render None percentage fields as '—' instead of 'None%'
741c4c2  FlipForge backend MVP
```

---

## 8. Known Issues

- Root `main.py` (backend) is an older v1 router setup — active app is `app/main.py`
- `app/core/analysis_engine.py` exists alongside `app/analysis_engine.py` — confirm which is imported before editing either
- `app/core/config.py` imports pydantic-settings but is dead code — not in active import chain
- CORS: `app/main.py` is already tightened to Vercel domain; CLAUDE.md docs say `*` but the code is correct — docs are stale
- Zillow/Redfin block URL scraping (SOURCE_BLOCKED) — known limitation, not a bug
- PDF generation must use in-memory bytes in production — disk writes will fail on Render
- Render free tier cold starts — first request after inactivity may take 50+ seconds
- No GitHub Actions CI — import/type errors are only caught at review time
- RentCast quota may be exhausted — do not run live /api/enrich-address without explicit approval
- **Photo Rehab Analyzer — estimate variability observed across repeated calls on same image**
  - Same photo produced Medium vs Heavy classifications across calls
  - Mid estimate range observed ~$24K–$52K on the same image
  - Root cause: non-deterministic LLM classification without temperature=0 enforcement
  - Not a current blocker; flagged for future prompt/consistency tuning
- **Photo Rehab Analyzer — API cost exists per photo analysis call (Anthropic charges per token)**
- **Photo Rehab Analyzer — cold start + AI call may be slow on first request (50s cold start + AI processing)**
- **Photo Rehab Analyzer — results are AI-assisted planning estimates, not contractor bids**
- **Photo Rehab Analyzer — unknown/invisible systems (roof, HVAC, electrical, plumbing) generate warnings, not pricing**
- **Verdict credibility gap — BUY via BRRRR with poor flip metrics:**
  - When best_strategy is BRRRR, overall_verdict can show BUY even when purchase_price > max_safe_offer, confidence is low, and flip margins are thin.
  - Example payload: purchase_price=140000, arv=200000, rehab_budget=25000, est_monthly_rent=1800, holding_months=6, interest_rate=10, ltc=80.
  - Observed UI: BUY / BRRRR / confidence 40/100 / net_profit $7,375 / profit_pct 3.8% / max_safe_offer $126,900 / "Purchase is $13,100 over Max Safe Offer."
  - Future fix: verdict consistency review — decide whether BUY should be suppressed or visually downgraded when purchase exceeds max safe offer, even if BRRRR is the best strategy.
  - Do not fix now. Do not touch analysis_engine.py.

---

## 9. Feature Backlog

**Photo Rehab Analyzer live QA is complete. Next feature requires PM scope approval before any code.**

### Next Features To Add (in priority order)

**Priority 1 — Deal Killer Summary** *(complete — PR #45, visual QA passed 2026-06-08)*
- Shipped frontend-only in src/components/DealKillerSummary.tsx.
- Renders between Offer Gap callout and Verdict card.
- Visual QA complete: PASS and BUY verdict cases confirmed in production. CONDITIONAL title not reproduced during QA due to test-data economics, not a component failure.
- Photo rehab mid threading (Priority 7 bullet) deferred — requires state lift from PhotoRehabAnalyzer into App.tsx.

**Priority 2 — Investor Action Plan**
- After each analysis, show next steps tailored to the result.
- Examples: offer no more than $X, verify roof/HVAC/electrical/plumbing, request access to crawlspace/attic/mechanicals, ask seller/agent specific questions, do not waive inspection, use negotiation script.

**Priority 3 — Copyable Investor Summary**
- One-click copy of property basics, rehab estimate, max safe offer, verdict, deal killers, risk warnings, next action.
- Useful for texting lenders, partners, agents, or investors.

**Priority 4 — Lender / Investor Report Polish**
- Make PDF/report feel lender-grade with better visual hierarchy.
- Include photo rehab summary (QA confirmed — ready to include).
- Include deal killer summary and action plan once built.

**Priority 5 — Comps / ARV Confidence Engine**
- Data-agnostic comp analysis, ARV bands (low/mid/high), confidence scoring, outlier handling.
- MLS/public data upgrades later.

**Priority 6 — Title / Lien / Auction Risk Engine**
- Tax delinquency, HOA/municipal liens, judgments/mechanic liens, preforeclosure, scheduled auction, probate/estate, code violations, closing delay risk, title-health badge.

**Priority 7 — Deal Alert Engine**
- Scan listings against buy box. Alert users to possible deals. Use underwriting/risk gates. Later premium feature.

**Priority 8 — Saved Deals / Deal Memory**
- Better saved deal history. Track photo rehab results. Track user decisions. Later feeds Learning Brain.

**Priority 9 — Contractor Marketplace** *(later, not now)*
- Contractor bidding from generated rehab scope. License/insurance profiles. Bid comparison. Marketplace revenue.

**Priority 10 — Learning Brain** *(later, not now)*
- Learn from analyzed, bought, sold, rented, failed deals. Calibrate rehab, ARV, title delays, contractor accuracy.

**Priority 11 — Social / Investor Profiles** *(later, not now)*
- Profiles, track record, reputation, connections.

**Parked: AIM — Asset Intelligence Modules**
- Cars, furniture, equipment, non-real-estate assets.
- Keep named and parked. Do not build until real estate MVP is validated.

---

## 10. Product Boundary

Real estate only for now.
- No AIM build.
- No marketplace build.
- No learning brain build.
- No new feature implementation without explicit PM scope approval.

---

## 11. How to Start a New Session

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

**Root cause:** Vite boilerplate `button { background-color: #1a1a1a; }` in src/index.css overrode Tailwind v4 `@layer` utilities.
**Fixes:** PR #34 (Number() coercion for RentCast estimates), PR #36 (remove global button rules), PR #37 (remove diagnostic panel).
**Note:** RentCast quota exhausted during debugging. Do not run more live tests without approval.

---

## Session 2026-05-10 — RentCast caching / quota protection

**PR:** backend #10, frontend #38
- New `rentcast_cache` SQLite table, 30-day TTL, cache key = normalized address
- `provider_status` Literal contract: cache_hit | live_success | quota_exhausted | provider_unavailable
- Cache write only on live_success. Failed/quota responses never cached.

---

## Session 2026-05-10 — Repair Budget Builder

**PR:** frontend #39 (merged, commit a46dda8)
- New component: src/components/RepairBudgetBuilder.tsx
- 9 repair categories, Low/Mid/High estimates, bathroom count stepper, sqft-based flooring, contingency selector
- "Use Mid as Rehab Budget" applies to existing rehab_budget field
- No backend changes. No AnalyzeRequest changes. No types.ts changes.

---

## Session 2026-05-10 — Result screen deal-memo polish

**PR:** frontend #40 (merged, commit 07654861)
- Offer Gap callout: Overpay Risk (red) / Offer Gap (amber) / Offer Cushion (green)
- "Why this verdict" rebuilt using backend result.notes as primary bullets
- Dead verdictReason lookup removed
- No backend changes. No schema changes.

---

## Session 2026-05-11 — Wire RepairBudgetBuilder into Legacy Manual Analyze

**PR:** frontend #41 (merged, commit 3a2b600)
- One line added inside {showLegacy && (...)} block: `<RepairBudgetBuilder onApply={(mid) => setRehabBudget(mid)} />`
- Live QA confirmed: visible in Manual Analyze Legacy, result screen still renders correctly.

---

## Session 2026-05-11 — Backend verdict hard-fail fix

**PR:** backend #11 (merged, commit 14d4dd4)
- overall_verdict now hard-fails to PASS when net_profit <= 0 AND purchase_price > max_safe_offer
- app/analysis_engine.py only. No schema/model/route changes.

---

## Production QA — Offer Gap callout (completed 2026-05-11)

All three Offer Gap callout states verified in production after backend PR #11 and frontend PR #40/#41.
- Red Overpay Risk (purchase 220k, ARV 300k, rehab 50k): PASS verdict, red card, narrative agrees.
- Amber Tight Offer (purchase 176k, ARV 300k, rehab 50k): Offer Gap card shown amber.
- Green Offer Cushion (purchase 160k, ARV 300k, rehab 50k): Offer Cushion card green, PDF + Negotiation Script available.

---

## Session 2026-06-04 — Photo Rehab Analyzer v1

**Backend PR:** #13 (merged, commit f39b1db)
**Frontend PR:** #42 (merged, commit 370f5f2)

**Backend (PR #13):**
- New endpoint: POST /api/photo-rehab-analysis (multipart/form-data)
- New service: app/services/photo_rehab_service.py — Anthropic vision AI call, response normalization, dev stub
- New pricing module: app/services/rehab_pricing.py — controlled SE US contractor pricing constants
- New Pydantic models in app/models.py: RoomFinding, RehabItem, PhotoRehabRiskFlag, PhotoRehabTotals, PhotoRehabAnalysisResponse
- New dependencies: python-multipart>=0.0.9, anthropic>=0.40.0
- AI identifies condition/severity only. Backend pricing controls all dollar estimates.
- Photos processed in memory only — never stored.
- Dev stub activated ONLY when PHOTO_REHAB_DEV_STUB=true. Not set in production.
- analysis_engine.py untouched. AnalyzeRequest unchanged. AnalyzeResponse unchanged.

**Frontend (PR #42):**
- New component: src/components/PhotoRehabAnalyzer.tsx
- New types in src/lib/types.ts: PhotoRehabCondition, PhotoRehabProviderStatus, RoomFinding, RehabItem, PhotoRehabRiskFlag, PhotoRehabTotals, PhotoRehabAnalysisResponse
- New API function in src/lib/api.ts: analyzePhotosForRehab() — multipart/form-data, 120s timeout
- Wired into Draft Deal flow: setDraftDpNumber("rehab_budget", v)
- Wired into Legacy Manual Analyze flow: setRehabBudget(mid)
- Both flows placed after RepairBudgetBuilder
- "Use Mid as Rehab Budget" applies result.totals.mid (post-contingency)
- npm run build passes cleanly. No new dependencies.

**Known risks going into QA:**
- Real Anthropic call not yet browser-tested
- API cost per photo analysis call
- Cold start + AI processing may be slow on first request
- Results are planning estimates, not contractor bids

---

## Production QA — Photo Rehab Analyzer (completed 2026-06-04)

**Result: PASS — core product loop validated end-to-end in production.**

**Manual Analyze Legacy flow:**
- 1 real property photo uploaded via https://flipforge-frontend.vercel.app
- provider_status: live_success (confirmed — real Anthropic vision call)
- Rehab estimate returned: overall condition, confidence score, low/mid/high totals, contingency %, missing photo warnings, risk flags, disclaimer
- "Use Mid as Rehab Budget" applied mid value into rehab_budget field
- Analyze Deal ran successfully using the applied rehab budget

**Draft/Resume flow:**
- URL draft flow opened
- Photo Rehab Analyzer appeared in draft flow
- 1 real property photo uploaded
- provider_status: live_success
- Mid rehab value applied into draft rehab_budget DataPoint field
- Finalize & Analyze ran successfully afterward

**Invalid upload checks:**
- PDF file: blocked at file-picker level (browser MIME filter)
- 12 photos: frontend validation triggered — "Maximum 8 photos. You selected 12."
- Oversized file: not tested — no >3MB test file available (not a blocker)

**Observation — estimate variability:**
- Same photo produced different condition classifications across calls (Medium vs Heavy)
- Mid estimate range ~$24K–$52K observed on the same image across calls
- Non-deterministic LLM behavior without temperature=0 enforcement
- Flagged for future tuning — not a current blocker

**QA conclusion:** Core loop is production-ready. Feature is ready for demo.
**Next step:** Scope Deal Killer Summary before any implementation.

---

## Session 2026-06-04 — Deal Killer Summary v1

**Frontend PR:** #45 (merged, commits c213c1b + b96c13f)

- New component: src/components/DealKillerSummary.tsx (frontend-only)
- Updated: src/AnalysisResult.tsx — import added, component placed between Offer Gap callout and Verdict card
- Up to 3 plain-English kill-reason bullets, title adapts by verdict
- Uses existing AnalyzeResponse fields only — no new API, no schema change, no backend change, no App.tsx change
- Fields used: overall_verdict, max_safe_offer, net_profit, profit_pct, confidence_score, risk_flags, typed_flags, stress_tests, purchase_price (via existing meta)
- Priority 7 (photo rehab uncertainty) wired but deferred: PhotoRehabAnalysisResponse state is internal to PhotoRehabAnalyzer.tsx and not available in App.tsx without a state lift
- Build: passed cleanly (110 modules, no errors)
- Unicode cleanup: 7 em dashes in comments replaced with ASCII hyphens (commit b96c13f) to clear GitHub Unicode warning
- Visual QA: COMPLETE (2026-06-08) — see Production QA session entry below

---

## Production QA — Deal Killer Summary (completed 2026-06-08)

**Result: PASS — component renders correctly for PASS and BUY verdict cases.**

**PASS / overpay case:**
- Deal with purchase price above max safe offer returned PASS verdict.
- Deal Killer Summary rendered with title "What Kills This Deal."
- Placement correct: between Offer Gap callout and Verdict card.
- Bullets were deal-specific and useful (over max safe offer, negative net profit, risk flag).
- Desktop layout clean.

**Clean BUY case:**
- Clean deal returned BUY verdict.
- Deal Killer Summary correctly rendered nothing — no empty card, no blank space.
- Desktop layout clean.

**BUY-with-risk case:**
- Deal returned BUY with qualifying risk conditions.
- Deal Killer Summary rendered with title "What Could Still Go Wrong" and useful guardrails.

**CONDITIONAL title:**
- Not reproduced during this QA pass.
- Test inputs kept resolving to BUY or PASS depending on strategy and economics.
- Engine/local testing found a flip-side CONDITIONAL-style case around purchase=140000 / arv=200000 / rehab=25000 / holding=6, but production UI resolved the full deal as BUY when BRRRR/rent inputs were included.
- Not a Deal Killer Summary failure. Component will render "What Makes This Risky" correctly when it receives a CONDITIONAL verdict.

**Known product issue discovered:**
- A deal can show overall_verdict BUY (via best_strategy=BRRRR) while also showing purchase above max safe offer, low confidence, and thin flip margins.
- See Known Issues section for full payload and future fix direction.
- Do not fix now.

**QA conclusion:** Deal Killer Summary v1 is visually confirmed. Ready to scope Investor Action Plan.
