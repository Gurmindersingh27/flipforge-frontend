# FlipForge — Project State
*Update this file at the end of every session. Upload alongside CLAUDE.md at the start of every session.*

---

## Last Updated
2026-03-17 (end of auth + deals dashboard session)

---

## 1. Current Phase & Progress

**Current phase:** Auth + saved deals pipeline complete. Deals dashboard live. Next: Open Deal (load saved deal back into analyzer).

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
- [x] Polish assumption input display: convert interest rate / LTC to percentage display
- [x] Clerk authentication implemented in frontend (ClerkProvider wraps app in main.tsx)
- [x] GitHub OAuth enabled via Clerk dashboard
- [x] Signed-out users see auth wall (SignInButton + SignUpButton, no analyzer access)
- [x] Signed-in users see analyzer (gated via Clerk's SignedIn/SignedOut components)
- [x] Save Deal button implemented in AnalysisResult — calls POST /api/deals/save with Clerk JWT
- [x] Deals dashboard implemented at /deals route (DealsPage.tsx) — lists saved deals, shows address/profit/ROI/date
- [x] Address display fallback in DealsPage: deal.address → deal.draft_input.address → "No address"
- [x] Backend: Clerk JWT verification via JWKS (app/auth.py, get_current_user_id dependency)
- [x] Backend: preload_jwks() made startup-safe with lazy-load fallback
- [x] Backend: POST /api/deals/save wired and authenticated
- [x] Backend: GET /api/deals wired and authenticated
- [x] Backend: GET /api/deals/{id} wired and authenticated

### Not Done
- [ ] Tighten CORS from * to https://flipforge-frontend.vercel.app
- [ ] Open Deal — load a saved deal back into the analyzer
- [ ] Delete deal
- [ ] Edit deal

### Next Session Goal
Implement Open Deal: load a saved deal from the dashboard back into the analyzer.
See Section 11 (Next Task) for full scope.

---

## 2. Repos

| Repo | GitHub | Deployed |
|------|--------|----------|
| Frontend | Gurmindersingh27/flipforge-frontend | https://flipforge-frontend.vercel.app |
| Backend | Gurmindersingh27/flipforge-backend | https://flipforge-backend.onrender.com |

Active dev branch (both repos): `claude/flipforge-dev-setup-FhRuA`
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
    analyze_service.py
    deal_service.py
    scenario_service.py
  schemas/                     ← analysis, deal, investor_profile, scenario
  api/
    deals.py
    v1/analyze.py, deals.py, profile.py, scenarios.py
  db/                          ← SQLite models (deal, user, analysis, scenario, investor_profile)
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
  main.tsx                    ← App entry point — wraps app in ClerkProvider
  App.tsx                     ← Root component — auth gate + analyzer + save deal button
  App.css / index.css         ← Global styles
  config.ts                   ← API_BASE_URL (keep separate from api.ts — do not merge)
  shield.ts                   ← Shield logic
  AnalysisResult.tsx          ← Deal analysis results display
  components/
    ShieldHeader.tsx          ← Header component
    DealsPage.tsx             ← /deals route — saved deals dashboard
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
- `saveDeal(payload, token)` → `POST /api/deals/save` (Clerk JWT required)
- `getDeals(token)` → `GET /api/deals` (Clerk JWT required)
- `getDeal(id, token)` → `GET /api/deals/{id}` (Clerk JWT required)

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

**AnalyzeRequest schema is frozen. Do not modify it.**

---

## 7. Commit History

**Frontend (recent, newest first):**
```
b5f058c  fix: fall back to draft_input.address when address column is null
9a60727  feat: gate analyzer behind Clerk auth, add SignUpButton
5bec63f  fix: disable Open button in DealsPage until location.state is wired up
666e37b  feat: add Clerk auth + saved deals frontend
f331bea  Merge pull request #5
9ba811d  docs: tick off Polish assumption input display in PROJECT_STATE.md
2ba222c  feat: display annual_interest_rate and loan_to_cost_pct as percentages
d0f19d8  docs: correct stale doc entries
3747221  Merge pull request #4
```

**Backend (recent, newest first):**
```
1838408  fix: make JWKS preload startup-safe with lazy-load fallback
621fb06  feat: add Clerk auth + saved deals persistence layer
f0a5032  Merge pull request #2
```

---

## 8. Known Issues

- Root `main.py` (backend) is an older v1 router setup — active app is `app/main.py`
- `app/core/analysis_engine.py` exists alongside `app/analysis_engine.py` — confirm which is imported before editing either
- `app/core/config.py` imports pydantic-settings but is dead code — not in active import chain, do not add pydantic-settings to requirements.txt
- CORS is wide open (`*`) — needs tightening to Vercel domain before production hardening
- Zillow/Redfin block URL scraping (SOURCE_BLOCKED) — known limitation, not a bug
- PDF generation must use in-memory bytes in production — disk writes will fail on Render
- Render free tier cold starts — first request after inactivity may take 50+ seconds
- GitHub OAuth is configured via Clerk dashboard (not in code); no code changes needed to enable/disable it

---

## 9. Database / Persistence State

- **ORM:** SQLAlchemy
- **DB layer:** `app/db/session.py` reads `settings.DATABASE_URL` (from `app/core/config.py`)
- **Default:** `sqlite:///./flipforge.db` — used locally and in production unless overridden
- **Configurable:** Yes — set `DATABASE_URL` env var on Render to switch to Postgres
- **Production today:** SQLite on Render's ephemeral filesystem. ⚠️ Data will be lost on each deploy/restart. This is a known limitation. Move to Postgres before treating saved deals as durable.
- **Schema managed by:** `app/db/init_db.py` (`init_db()` called at startup via `on_startup`)
- **SavedDeal model:** `app/db/models/saved_deal.py`

---

## 10. Explicitly Unchanged / Protected Systems

The following were NOT modified in any session and must remain untouched:

- `AnalyzeRequest` schema — frozen, no field additions or removals
- `app/analysis_engine.py` — core underwriting math, do not rewrite
- `POST /api/analyze` — route, request shape, and response shape unchanged
- `POST /api/draft-from-url` — unchanged
- `POST /api/finalize-and-analyze` — unchanged
- Core scoring engine (verdict thresholds, stress test logic, breakpoints, rehab reality) — unchanged

---

## 11. Known Limitations / Open Gaps

- **Open Deal not implemented** — saved deals can be listed in DealsPage but cannot be loaded back into the analyzer. The Open button exists in the UI but is disabled.
- **Compare is placeholder only** — button exists, no functionality behind it
- **Delete deal not implemented**
- **Edit deal not implemented**
- **Address normalization at save-time** — the backend saves `address` as a dedicated column, but older deals (saved before this column was added, or where scraping failed) may have `address=null` with the address embedded in `draft_input` JSON. Frontend has a fallback for display but save-time normalization could be improved.
- **SQLite on Render is ephemeral** — saved deals will be lost on redeploy. Production should move to Postgres for durable persistence.
- **CORS not tightened** — still `allow_origins=["*"]`

---

## 12. Next Recommended Task

**Implement Open Deal** — load a saved deal back into the analyzer.

Scope:
- Additive only — no schema changes, no analysis engine changes
- When user clicks Open on a deal in DealsPage, load the saved `draft_input` (DraftDeal) back into the analyzer state in App.tsx and navigate to the analyzer view
- Reuse the existing `getDeal(id, token)` API call already in `api.ts`
- Reuse the existing DraftDeal type — no new types needed
- Show Plan + File Diff before coding, wait for approval

---

## 13. Workflow / Guardrails (preserve across sessions)

1. **Load repo skills first** before doing any work
2. **Plan → File Diff → Approval → Implementation** — no exceptions
3. **Additive changes only** — do not rename fields, remove routes, or change response shapes
4. **No silent dependency installs** — get explicit approval before touching requirements.txt or package.json
5. **No schema changes without approval** — AnalyzeRequest is frozen; any other schema change needs PM sign-off
6. **Do not refactor working systems** — if it works, leave it alone unless there is a specific bug to fix

---

## 14. How to Start a New Session

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
