# Frontend release readiness — September 11, 2026

Status: reviewed and tested, awaiting PM release authorization. This document does not merge or deploy either PR. These notes are on a separate documentation branch so both reviewed heads remain intact.

## Verified state

| Item | Current commit | Evidence |
| --- | --- | --- |
| Frontend main / merged #61 | `0e56e784efbc41cc840c6bd1e1e18a6212eca92b` | Public production assets matched the source build byte-for-byte on September 11; release run `34559143390` also passed against this main. |
| #62, base main | `35e5014a52811d5490363e34ee08c94098dad890` | [CI 34559143324](https://github.com/Gurmindersingh27/flipforge-frontend/actions/runs/34559143324) passed: 37 unit tests, build, browser workflow. Reviewer reports no blockers. |
| #63, stacked on #62 | `ed16dfa993fcf5e1ff2a62ccae69ee201382766e` | [CI 34603166605](https://github.com/Gurmindersingh27/flipforge-frontend/actions/runs/34603166605) passed: 67 unit tests, build, browser workflow. Reviewer accepted D1/D2 corrections. |
| Backend main / merged #18 | `efe27e032ef85dd130ec267e9166ce878fcdc1cc` | Deployed scope/revision contract verified previously. No backend release needed for these frontend PRs. |

The #63 browser job `103275167492` passed 15 checks through Chrome, the frontend, the real backend and isolated SQLite. It covers the revised baseline, both bids, unchanged allowance-price confirmations and resets, continuation, and unchanged prior records. This is CI evidence; Chrome could not run locally. Captured screenshots have not been manually inspected. Local validation previously reproduced 67 tests and the build; lint still has the same ten pre-existing errors. No additional runtime tests were run for these documentation edits.

The shared Claude review is reviewer evidence supplied by the PM; it is not a GitHub approval event or the PM's release authorization. The public check of main does not establish that either draft PR is deployed.

## Release sequence after authorization

1. Recheck main, both PR heads and current CI. If source changed beyond the reviewed heads, review that change before proceeding. Mark #62 ready and merge with a **merge commit**, pinning its expected head to `35e5014a52811d5490363e34ee08c94098dad890`. Preserve its ancestry because #63 contains those commits.
2. Record the resulting main SHA. Confirm Vercel success for that commit, then run `tests/productionSmoke.mjs` from a checkout of that exact merge with the existing dependencies. Alternatively dispatch the release-verification workflow with `frontend_ref` set to that full SHA when permitted access is available. Require successful production asset-byte comparison and public API checks before continuing. A Vercel status alone is insufficient.
3. Retarget #63 to main. Its standalone diff must contain only its own work, listed below. Do not rebase, force-push or reintroduce #62 changes to compensate for an incorrect merge method.
4. In one #63 cleanup commit, change `.github/workflows/frontend-ci.yml` from `branches: [main, codex/release-closeout-20260911]` to `branches: [main]`. Keep manual dispatch and both existing jobs. This removes the temporary stacked-PR trigger; no application changes belong in this commit.
5. Record the new #63 head and require green **unit tests, production build and browser job at that head**. Expect 67 tests unless an explicitly reviewed change explains a different count. The green run at `ed16dfa` cannot validate a later head. Mark ready and merge with the expected head pinned only after these gates pass.
6. Record that merge SHA and repeat Vercel plus public production verification against it. If a gate fails, stop the dependent release step, record the failure and investigate. Do not report a deployment as verified or perform an automatic rollback without assessing the actual failure.

The public checker performs stateless analysis requests; it does not sign in or write saved deals. The release-verification workflow does not automatically run for #63's current diff. Personal signed-in save/reopen/revise QA remains a separate founder check after release, with the founder handling login. Live storage durability/backups/restore and provider usage controls remain unverified; source defaults do not establish actual hosted configuration. Backend #19 is excluded from this release.

Expected #63 files relative to #62 before CI cleanup:

```
.github/workflows/frontend-ci.yml
PROJECT_STATE.md
src/components/BidComparison.tsx
src/components/DealPage.tsx
src/components/RehabScopeEditor.tsx
src/lib/bidComparison.ts
src/lib/rehabScope.ts
tests/bidComparison.test.ts
tests/browserFlow.mjs
tests/rehabScope.test.ts
```

After cleanup, `frontend-ci.yml` should no longer differ from main. The three documentation files on this separate notes branch are not an additional #63 source change or a release prerequisite.

## Remaining review items

- **R1 — explicit baseline choice:** a quoted revision with no quoted children defaults to its parent. Use “Start new bids from this version” or Resume on the current page to establish a new baseline. Do not infer user intent from changed holding months: a contractor option can itself change schedule. Revisit if observed pilot use shows persistent confusion.
- **R2 — continued bid navigation:** a bid with a quoted child prioritizes that child. Compare the original sibling bids from their common baseline page. No saved links or records change. Revisit when users need to compare continued branches together.
- **R3 — inherited provenance:** same-price checks inspect the immediate baseline; they do not trace an allowance relabeled in earlier ancestry. All quote labels remain user-entered claims. Changed prices and temporary confirmation are not document verification. This limitation must be explained during pilot use; inherited prices need review against the user's source. Durable provenance review remains future scope.
- #62's optional blank-field display and key-regex notes remain nonblocking; no cosmetic patch has been added to the reviewed release.

Full Quote Review + Missing Scope, durable review decisions, explicit pricing of unresolved work and document parsing remain proposed. This release compares saved budgets and their deal impact. No investor enrollment, repeat use, payment or customer validation is established.
