Run this checklist at the start of every FlipForge session. Do not write or modify any code until every item below is confirmed. If any item cannot be confirmed, stop and tell the user what is missing.

---

## Step 1 — Repo Presence

Confirm both repos are cloned and readable:
- `flipforge-frontend` (Gurmindersingh27/flipforge-frontend)
- `flipforge-backend` (Gurmindersingh27/flipforge-backend)

If either is missing, output:
> BLOCKED: [repo name] is not loaded. Clone it before proceeding.

---

## Step 2 — Read Project Docs

Read these files in full before anything else:
1. `flipforge-frontend/CLAUDE.md`
2. `flipforge-frontend/PROJECT_STATE.md`

(If backend has its own CLAUDE.md, read that too.)

Confirm you have read both by summarising in one sentence what the current phase is.

---

## Step 3 — Branch Confirmation

For each repo, run `git branch --show-current` and report the result.

Confirm the frontend is on: `claude/load-claude-skills-IpLZn`
Warn if either repo is on `main` or `master` — do not proceed until the user switches.

---

## Step 4 — Locked Rules (restate verbatim)

State these rules out loud before proceeding:

1. **AnalyzeRequest schema is frozen.** No fields may be added, removed, or renamed.
2. **Schema changes are additive only.** New optional fields only; never modify existing ones.
3. **Any type change must be mirrored** in both `src/lib/types.ts` (frontend) and `app/models.py` (backend) in the same session.
4. **Never push to `main` or `master` directly.**
5. **Active backend entry point is `app/main.py`**, not root `main.py`.
6. **PDF generation must use in-memory bytes** — no disk writes on Render.

---

## Step 5 — Active Analysis Engine

Read the import chain in `app/main.py` and confirm which analysis engine file is actually imported:
- `app/analysis_engine.py` ← likely active
- `app/core/analysis_engine.py` ← possible duplicate

Report: `Active engine: app/[path]/analysis_engine.py`
If unclear, diff the two files and report the discrepancy to the user.

---

## Step 6 — Current Task

Read `PROJECT_STATE.md` section "Not Done" and "Next Session Goal".

Ask the user: **"What is the single task for this session?"**

Do not assume. Do not start a task from the backlog without explicit instruction.

---

## Gate

Only after all 6 steps are confirmed, output:

> Session boot complete. Ready for your task.

If any step fails or is ambiguous, output:

> BLOCKED: [step name] — [reason]. Resolve this before proceeding.
