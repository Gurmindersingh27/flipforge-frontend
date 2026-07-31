# FlipForge — CLAUDE.md
*Read this file before doing anything. This is the source of truth.*

---

## Non-Negotiable Rules

1. Do not rename or change any existing schema fields, API paths, or response shapes. Additive changes only.
2. Do not refactor folder structure or "clean up" code. Keep files where they are.
3. Before any code changes, output a Plan + File Diff List (files you'll touch + why). Wait for approval.
4. Deployment first. No UI work until backend is live and Vercel can call it successfully.
5. Code is source of truth. If this doc conflicts with actual source files, follow the code.
6. Do not add dependencies without explicit approval.
7. Do not push to main directly. Work on a feature branch, let the PM review the diff first.
8. Any type change must be made in BOTH app/models.py (backend) AND src/lib/types.ts (frontend) simultaneously.

---

## What FlipForge Is

A risk-first real estate deal underwriting tool. Not a cashflow calculator — a "where does this deal break?" engine.

**Short pitch:** Upload the house. Know the rehab. Know the offer.

**Core user flow:**
1. Paste listing URL or enter deal info → backend returns best-effort DraftDeal
2. Upload property photos → Photo Rehab Analyzer estimates visible rehab scope and cost
3. User applies mid rehab estimate and fills any missing fields
4. Frontend posts to `/api/finalize-and-analyze`
5. Backend returns full AnalyzeResponse (verdict, risk cards, stress tests, breakpoints, rehab reality, narratives)
6. User downloads lender PDF report

**Target users:** Serious investors, hard money lenders, BRRRR operators, acquisition managers. Not beginners.

---

## Two Repos — Both Required

| Repo | Remote | Status |
|------|--------|--------|
| Frontend | github.com/Gurmindersingh27/flipforge-frontend | Public |
| Backend | github.com/Gurmindersingh27/flipforge-backend | Public |

To start a session:
```
git clone https://github.com/Gurmindersingh27/flipforge-frontend
git clone https://github.com/Gurmindersingh27/flipforge-backend
```

---

## Frontend (React + TypeScript + Vite)

**Stack:** React 19 / TypeScript ~5.9 / Vite 7 / No UI library / Vanilla CSS

**Source files:**
```
src/
  main.tsx                    # App entry point
  App.tsx                     # Root component — LTC display sourced from underwriting value,
                              # manual LTC input removed, 90% default via DEFAULT_LTC_PCT (PR #56);
                              # non-positive rent normalized to null in manual + draft flows (PR #57)
  App.css / index.css         # Global styles
  config.ts                   # API_BASE_URL (reads VITE_API_BASE_URL, fallback http://127.0.0.1:8000)
  shield.ts                   # Shield logic
  AnalysisResult.tsx          # Investor Memo results display — five-zone memo (PR #49),
                              # premium styling alignment (PR #51),
                              # breakpoint prominence + lender-memo copy polish (PR #54),
                              # LTC caption accuracy for both flows (PR #56)
  components/
    ShieldHeader.tsx          # Unmounted since PR #49; removal is not scoped
    RepairBudgetBuilder.tsx   # Manual repair budget estimator (frontend-only, PR #39+#41)
                              # Available in: Draft Deal, Resume Deal, Manual Entry
    PhotoRehabAnalyzer.tsx    # Photo rehab analyzer (PR #42, wired into all flows)
                              # Uploads photos → AI estimates condition → applies mid to rehab_budget
    DealKillerSummary.tsx     # Deal Killer Summary (PR #45, frontend-only; copy polish PR #54)
    InvestorActionPlan.tsx    # Investor Action Plan v1 (PR #47, frontend-only)
    InvestorMemoPreview.tsx   # Static sample Investor Memo Preview panel (PR #50, presentational)
    WorkflowRail.tsx          # Visual-only workflow rail (PR #50; label wrap fix PR #52)
    DealPage.tsx              # View Saved Deal page (/deal/:id)
    DealsPage.tsx             # Saved Deals list page
  lib/
    api.ts                    # All fetch calls to backend — DO NOT restructure
    types.ts                  # All shared TypeScript types — canonical contract
  assets/
    react.svg
```

**API calls (src/lib/api.ts):**
- `POST /api/analyze` → `analyzeDeal()`
- `POST /api/draft-from-url` → `draftFromUrl()`
- `POST /api/finalize-and-analyze` → `finalizeAndAnalyze()` (handles 422 missing_fields)
- `POST /api/export/lender-report` → `exportLenderReportPdf()`
- `POST /api/generate/negotiation-script` → `generateNegotiationScript()`
- `POST /api/enrich-address` → `enrichAddress()`
- `POST /api/photo-rehab-analysis` → `analyzePhotosForRehab()` (multipart/form-data, 120s timeout)

**Key types (src/lib/types.ts):**
- `AnalyzeRequest` / `AnalyzeResponse`
- `DraftDeal` with `DataPoint<T>` confidence metadata
- `DraftFromUrlResponse` — wrapper `{ draft: DraftDeal }`
- `Verdict`: `"BUY" | "CONDITIONAL" | "PASS"`
- `Strategy`: `"flip" | "brrrr" | "wholesale"`
- `RehabReality`, `Breakpoints`, `RiskFlag`, `StressTestScenario`
- `ProviderStatus`: `"cache_hit" | "live_success" | "quota_exhausted" | "provider_unavailable"`
- `EnrichAddressResponse` with optional `from_cache`, `cached_at`, `provider_status`, `provider_error`
- `PhotoRehabCondition`: `"light" | "medium" | "heavy" | "unknown"`
- `PhotoRehabProviderStatus`: `"live_success" | "ai_not_configured" | "ai_error" | "dev_stub"`
- `PhotoRehabAnalysisResponse`, `RoomFinding`, `RehabItem`, `PhotoRehabRiskFlag`, `PhotoRehabTotals`

**NPM scripts:**
```
npm run dev       # Vite dev server
npm run build     # tsc + vite build
npm run lint      # ESLint
npm run preview   # Preview production build
```

---

## Backend (Python + FastAPI)

**Stack:** FastAPI 0.115 / Uvicorn / Pydantic v2 / httpx / BeautifulSoup4 / ReportLab / SQLite (dev)

**Entry point:** `app/main.py`

**Source structure:**
```
app/
  main.py                      # FastAPI app, all route definitions
  models.py                    # Pydantic models — canonical contract, mirrors types.ts
  analysis_engine.py           # Core deal math (DO NOT REWRITE)
  core/
    analysis_engine.py         # Also exists — confirm which is active before touching
    config.py                  # Settings (DATABASE_URL via pydantic-settings)
    scoring.py
  services/
    url_service.py             # URL scraping → DraftDeal
    pdf_service.py             # Lender report PDF generation (production risk — see below)
    rentcast_service.py        # RentCast enrichment + SQLite cache (30-day TTL)
    analyze_service.py
    deal_service.py
    scenario_service.py
  schemas/                     # analysis, deal, investor_profile, scenario
  api/
    deals.py
    v1/
      analyze.py
      deals.py
      profile.py
      scenarios.py
  db/                          # SQLite models (deal, user, analysis, scenario, investor_profile, rentcast_cache)
render.yaml                    # Render.com deployment config
requirements.txt
```

**Live API endpoints:**
```
GET  /api/health
POST /api/analyze                  # Core deal analysis — AnalyzeRequest schema is FROZEN
POST /api/draft-from-url           # Scrape listing URL → DraftDeal
POST /api/finalize-and-analyze     # DraftDeal → AnalyzeResponse (422 if fields missing)
POST /api/export/lender-report     # AnalyzeResponse → PDF bytes
POST /api/enrich-address           # { address } → EnrichAddressResponse (SQLite cache, 30d TTL)
POST /api/photo-rehab-analysis     # multipart/form-data → PhotoRehabAnalysisResponse
                                   # 1-8 photos, max 3MB each, JPEG/PNG/WEBP only
                                   # provider_status: live_success | ai_not_configured | ai_error | dev_stub
```

**Run locally:**
```
uvicorn app.main:app --reload
```

---

## Shared Data Contract

Any change to these types must be made in BOTH files simultaneously:

| Type | Frontend | Backend |
|------|----------|---------|
| `AnalyzeRequest` | src/lib/types.ts | app/models.py |
| `AnalyzeResponse` | src/lib/types.ts | app/models.py |
| `DraftDeal` | src/lib/types.ts | app/models.py |
| `DataPoint<T>` | src/lib/types.ts | app/models.py |
| `ProviderStatus` | src/lib/types.ts | app/models.py |

**AnalyzeRequest schema is frozen. Do not touch it.**

---

## Known Production Risk — PDF Export

`pdf_service.py` must:
- Use **in-memory bytes** (`StreamingResponse`) — no writing to disk
- Handle asset paths (fonts, logos) correctly for cloud deployment
- This is the #1 "works locally, dies in prod" failure point

Do not touch pdf_service.py without explicitly flagging this risk first.

---

## Deployment State

- **Backend:** Render.com (render.yaml present in repo)
  - Live: https://flipforge-backend.onrender.com
- **Frontend:** Vercel (linked to GitHub)
  - Live: https://flipforge-frontend.vercel.app
- **CORS:** `app/main.py` currently sets `allow_origins=["https://flipforge-frontend.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"]` with `allow_credentials=True`
- **Env var:** Frontend reads `VITE_API_BASE_URL` — must be set to live Render URL on Vercel
- **Pipeline status:** `/api/analyze`, `/api/export/lender-report`, and `/api/generate/negotiation-script` confirmed working in prod
- **Lender demo integrity fixes (2026-07-31):** LTC display (PR #56) and non-positive rent normalization (PR #57) merged and production-tested against the locked demo set. Frontend-only; no backend, engine, schema, AnalyzeRequest, API-contract, type, dependency, scoring, confidence, or risk-logic changes.
- **Photo Rehab env vars (Render):** `ANTHROPIC_API_KEY` set (hidden), `ANTHROPIC_MODEL=claude-sonnet-4-5` set
- **PHOTO_REHAB_DEV_STUB:** NOT set in production — do not add it

---

## Commit History

**Frontend:**
```
fc0aab5  Merge pull request #57 — fix: treat non-positive rent as omitted
6f0b01c  Merge pull request #56 — fix: align displayed LTC with underwriting assumption
5ee54a8  Merge pull request #55 — docs: close Demo Readiness v1A and set demo conversion goal
77d9434  Merge pull request #54 — Demo Readiness v1A: Breakpoint prominence and lender memo polish
18622b9  feat: elevate breakpoint risk in investor memo (PR #54)
75eef17  Merge pull request #52 — fix: prevent workflow rail label overlap
7f0101a  Merge pull request #51 — style: align analyzer body with product experience reset
bf36b5e  Merge pull request #50 — feat: add product experience reset layout
5509ee9  Merge pull request #49 — feat: add investor memo results layout
d60ac18  Merge pull request #48 — Add negotiate-first verdict modifier
0338fcd  feat: add Investor Action Plan v1 to result screen (PR #47)
e042aea  Merge pull request #46 — docs: record Deal Killer Summary visual QA results
1776104  Merge pull request #45 — feat: add Deal Killer Summary v1
370f5f2  feat: add photo rehab analyzer frontend (PR #42)
3a2b600  fix: show repair budget builder in legacy manual analyzer (#41)
07654861 feat: result screen deal-memo polish — offer gap callout + verdict rationale (#40)
a46dda8  Merge pull request #39 — feat: add Repair Budget Builder
c5809c2  fix: add ProviderStatus type and cache metadata fields to EnrichAddressResponse (#38)
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

## Session Start Checklist

- [ ] Read this file completely before touching any code
- [ ] Clone both repos if not already present
- [ ] Confirm current goal with PM before starting
- [ ] Output Plan + File Diff List before writing any code
- [ ] Wait for approval before executing
