Run this checklist at the end of every FlipForge session before closing. Complete every step in order.

---

## Step 1 — What Was Done

List every change made this session as bullet points:
- File modified → what changed and why
- Endpoint added/changed → new behaviour
- Type changed → what field, in which files

---

## Step 2 — Update PROJECT_STATE.md

Make the following updates (and no others):

1. **Last Updated** → today's date (YYYY-MM-DD)
2. **Done** → move any completed items from "Not Done" to "Done", or add new ones
3. **Not Done** → add any new backlog items discovered this session
4. **Next Session Goal** → single next task only (no list)
5. **Commit History** → prepend new commits (frontend and backend separately)

Do not rewrite, reorganise, or reformat any other section.

---

## Step 3 — Verify Nothing Is Broken

Confirm each of the following before committing:

- [ ] `npm run build` passes in frontend (no TypeScript errors)
- [ ] Backend starts without import errors (`python -c "from app.main import app"`)
- [ ] No hardcoded localhost URLs remain in committed code
- [ ] No `.env` or secret files staged for commit

If any check fails, fix it before proceeding.

---

## Step 4 — Commit

Stage only files that were intentionally changed this session.
Never use `git add .` or `git add -A`.

Commit message format:
```
<type>: <short description>

- <bullet: what changed>
- <bullet: what changed>
```

Types: `feat` / `fix` / `refactor` / `docs` / `chore`

Push to the active feature branch. Never push to `main` or `master`.

---

## Step 5 — Handoff Summary

Output a summary block the user can copy into the next session:

```
SESSION HANDOFF — [date]
Branch: [frontend branch] / [backend branch]
Completed: [one-line summary]
Next task: [one-line summary]
Blockers: [none | description]
```

---

## Gate

After all steps complete, output:

> Handoff complete. Safe to close.

If PROJECT_STATE.md was not updated or the build check failed, output:

> BLOCKED: [reason]. Do not close until resolved.
