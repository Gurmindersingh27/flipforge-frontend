# Pilot data handling — proposed operating procedure

**Draft for founder adoption.** This is an internal procedure proposal, not an active privacy policy, legal assurance or implemented access-audit feature. Do not send its participant wording until the founder adopts the procedure and can carry it out.

## First session

- Use manual deal inputs and the participant's current estimate. Competing quotes are optional. Let participants sign in themselves; never request passwords, session tokens or 2FA codes.
- Prefer reviewing the participant's screen without retaining source documents. Ask them to redact names, contact details, signatures, account numbers and other unnecessary details before sharing examples. Property addresses can also be sensitive.
- Before retaining a quote or session recording, agree on the purpose, exact material, who may access it, storage location and deletion date. Default to no retained quote copies and no recording. Do not place private participant data in public git, CI artifacts or third-party AI tools without specific permission and an agreed handling process.
- Explain that quote labels, prices, dates and exclusions are entered by the user. FlipForge does not authenticate contractor documents. Inherited quote lines may not receive a new price check. Missing itemization means unknown coverage, not free or excluded work. Confirm sources before using a comparison to make an offer.

## Saved deals and operator access

The current API saves draft inputs, analysis results, itemized scope, notes and revision links. Saved-deal routes require a Clerk session and filter records by owner. Those application checks do not prevent an authorized infrastructure operator from accessing database contents.

Proposed operator procedure:

1. Open a participant's stored deal only at their request or when necessary to investigate a specific technical problem. Reviewing a participant's own screen with permission is preferable where sufficient.
2. Read only the relevant records. In a private operational log, record the reason, operator, time, minimum relevant record IDs and notification status. Do not copy quote text or deal contents into that log. Select the log's private location before the first such access; this repository is not that location.
3. Tell the participant about access. For requested support, state what will be inspected before accessing it; for necessary incident investigation, notify them promptly and record when that happened.
4. Do not inspect stored deals merely to measure pilot engagement. Ask participants whether they returned, what they changed and whether anyone prompted that visit. Separate independent return from a scheduled follow-up; any later telemetry needs its own disclosure and implementation.

These steps are manual obligations for the founder, not controls enforced by this draft. No production saved records were opened to prepare it.

## Retention and removal

No self-service saved-deal deletion route was found in the reviewed backend save/list/get API. A removal request therefore needs a separately authorized operational process, including linked revisions. Do not promise immediate deletion from backups or a retention period that has not been checked with the actual hosting setup.

Before accepting material that needs a guaranteed storage or deletion policy, verify the live database configuration, durability, backup retention and restore process. The source has a local SQLite default; this does not prove how production storage is configured. Participants should retain their originals. Do not claim verified encryption, backup guarantees, provider data-use terms or access auditing based on owner checks alone.

## Proposed participant explanation

“Bring your current estimate; contractor quotes are optional. You can show us a redacted example without giving us a copy. Saving a deal stores the inputs, results and notes you choose to enter. We will look at a saved deal only if you ask us to or if needed to investigate a technical problem, and we will tell you when we do. Quote details are user-entered and need checking against your source. Keep your originals. Before we retain any quote document or recording, we will agree with you on its use, storage and deletion.”

This wording is a draft commitment for adoption, not an invitation sent to anyone. Pilot outreach remains unsent. Follow-up can ask for repeat use with the existing estimate; it must not advertise an unmerged feature as live.
