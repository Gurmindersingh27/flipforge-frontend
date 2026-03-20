Run this planning checklist before implementing any new feature. Do not write code until the plan is approved by the user.

---

## Step 1 — Feature Statement

State the feature in one sentence:
> "This feature will [verb] [what] so that [user benefit]."

If you cannot state it in one sentence, ask the user to clarify scope before continuing.

---

## Step 2 — Schema Impact Check

Answer each question explicitly (yes / no / unknown):

1. Does this feature add or change any field in `AnalyzeRequest`?
   - If yes: STOP. AnalyzeRequest is frozen. Redesign to avoid touching it.
2. Does this feature add fields to any other shared type?
   - If yes: new fields must be optional with defaults. List them.
3. Does this feature require a new API endpoint?
   - If yes: name it and describe its request/response shape.

---

## Step 3 — Affected Files

List every file that will be created or modified, in both repos:

**Backend:**
- [ ] `app/main.py` — (why)
- [ ] `app/models.py` — (why)
- [ ] `app/services/...` — (why)

**Frontend:**
- [ ] `src/lib/types.ts` — (why)
- [ ] `src/lib/api.ts` — (why)
- [ ] `src/components/...` — (why)

If a file is in both backend and frontend (shared type change), flag it explicitly:
> MIRROR REQUIRED: types.ts + models.py must change together.

---

## Step 4 — Implementation Steps

Write a numbered plan, maximum 8 steps. Each step must be:
- A single atomic change
- Testable independently where possible
- Ordered so the app is never broken mid-implementation

---

## Step 5 — Risk Flags

List any known risks:
- Breaking changes to existing routes
- Cold start / Render memory concerns
- CORS implications
- PDF generation (in-memory only)
- Auth implications (Clerk — ensure token is passed, protected routes respected)

If no risks apply, write: "No known risks."

---

## Gate

Present the completed plan to the user and ask:

> "Does this plan look correct? Approve to begin implementation."

Do not write a single line of code until the user approves.
