# Items field guide

Optional, free guidance in the photo-entry card. The guide is collapsed by
default and usable before sign-in. It covers office chairs, dressers/cabinets,
and general furniture. It never reads photos, decodes a product number,
authenticates an item, estimates repair costs, or changes comparable eligibility.

## Evidence and wording

Manufacturer label guidance checked 2026-11-08:

- Herman Miller: https://www.hermanmiller.com/customer-service/warranty-and-service/
  The manufacturer describes the underside label and requests the complete
  product number, FO number and manufacture date. Label examples are linked.
- Steelcase: https://sg.steelcase.com/pages/warranty-claim
  The manufacturer's service page asks for the sticker under the seat with the
  PO number. This source is used for label location only, not warranty eligibility.

Other inspection steps are general prompts to the user, not manufacturer
diagnostics. Looks OK means a user observation only. Unrecorded answers remain
Not checked, including parts the user cannot test. A partial label never becomes
Mirra 1/2, a confirmed brand, an authentic item, or a clean bill of health.

## Data behavior

The guide holds a temporary draft in component state. No network, storage,
assessment or provider call is made by any guide action. Reloading, leaving the
entry page, or changing the current signed-in account/session clears that draft.
Signing in from a signed-out draft follows the existing photo-entry behavior.

Add notes to description explicitly appends user observations. It preserves the
existing description byte for byte, rejects an addition exceeding 500 characters,
and blocks an identical repeated addition. Changing the guide later does not
change text already added to the description; the description remains editable.
If the earlier block is still present, adding changed guide notes is blocked to
avoid stacking conflicting inspection answers. The user can edit the description
directly or remove that earlier block before appending the revised notes.
If the user subsequently requests an assessment, the description follows the
existing paid assessment flow. Adding guide notes alone sends nothing.

No new API, schema, dependency, calculator change or saved-record mutation.
This is not persistent project inspection tracking. Existing estimates and the
post-assessment repair review are unchanged.

## Verification

- `npm test`: note completeness, unresolved identity, checklist isolation,
  exact append preservation, duplicate suppression and character-limit boundaries.
- `ITEM_FIELD_GUIDE_ONLY=1 BACKEND_DIR=../ff-backend node tests/browserFlow.mjs`:
  uses the existing local synthetic sign-in/provider fixtures; no paid service.
- The same checks also run in the full browser suite, at 390px and 1440px.
  Screenshots use the existing `photo-*.png` CI artifact collection.

Physical iPhone behavior and in-person inspection usefulness still need a real
device/item check. General reminders are not a substitute for specialist checks.
