# AI Botanist actions — natural-language plant updates (2026-10)

"השקיתי את כל הצמחים במרפסת" → a confirmation card in the same chat → records only after **אישור ושמירה**.

## Pipeline
1. **Pre-filter (no model):** only first-person reports and explicit requests (השקיתי, דישנתי, טיפלתי, ריססתי, העברתי, בדקתי/נבדקו, תזכירי…) — or a pending card / an open clarifying question in this chat — go to the parser. Questions ("מתי להשקות?") stream as before, with no extra call.
2. **Understand (Claude, one structured call, `src/worker/actions.ts` + `action-schema.ts`):** JSON schema output: intent (`new_action` / `modify_pending` / `confirm_pending` / `cancel_pending` / `chat`), action from an allowlist (`water`, `fertilize`, `soil_check`, `treatment`, `move`, `reminder`, `note`), scope, name/place/date **phrases**, pest, product. Input: the user's own plants as short keys (`p1 | name | species | scientific | place | status`) and places (`l1 | name`) — no histories, photos or record ids. Output is validated strictly (`sanitizeParsed`): unknown values become "chat"/"none"; keys outside the list are dropped.
3. **Decide (deterministic, `src/shared/actions.ts`):**
   - Targets: keys validated against the list the server built from this user's rows, then Hebrew-aware name matching (prefixes ה/ל/ב/ו/מ/ש, plurals, nicknames first, "#2" duplicates, scientific names). Scopes: one plant, several named, a saved location, all, by status (שתילים / ייחורים), the plant of the conversation. Archived, deleted, wishlist and catalog species are never targets.
   - Ambiguous name ("המונסטרה" with two Monsteras), unknown name/place, missing soil state → one short question; the next message is parsed together with the original request.
   - Dates: היום / אתמול / שלשום / לפני X ימים / שבוע / שבועיים / חודש / weekday names / dd.mm(.yy|.yyyy), in the user's time zone (sent by the app; fallback Asia/Jerusalem). Weekday + date must agree (13.10.2026 is a Tuesday). A past action can't be in the future, a reminder can't be in the past. Earlier days are stored at local noon with `precision: "day"`.
   - Duplicates: plants that already have the same action on that local day are shown but unselected ("כבר נרשם באותו יום").
4. **Propose:** the card (`ActionProposal`) is stored inside the server-written assistant message. Clients cannot push `message` records, so the card they confirm is exactly the one the server validated. Corrections ("לא לפוטוס", "גם למוצי", "בעצם אתמול") create a new revision; the old card is marked superseded. Typed "כן" points to the button. Typed "בטלי" cancels.
5. **Execute (`POST /api/v1/actions/execute {messageId, revision, plantIds, followUp}`):** only plants of that revision (others → 400), only while pending/executing (closed → 409, other revision → 409). Saved in atomic chunks (≤7 record mutations + the progress, D1 Free plan ≈50 queries per request); the app loops until done. Record and mutation ids are derived from (card, plant, kind) → a double tap, a retry after a lost response or two concurrent confirms never write twice. A plant archived/deleted in between → reported per plant (`partial`), the rest is saved. The result message ("עודכנו 12 צמחים בהצלחה 🌱") is written in the same batch as the last records, so it never claims more than was stored. `POST /api/v1/actions/cancel {messageId}` closes a pending card.

## Records (same shapes as the single-plant actions in the app)
| Action | Records |
|---|---|
| water / fertilize | `event` watering / fertilizing (`source: "ai_confirmed"`, `payload.via: "ai_chat"`) → derived soil-check / fertilizing schedules recompute as usual |
| soil_check | `event` soil_check `{result, watered: false}` — never "dry" unless the user said so, never a watering |
| treatment | reuse the plant's open health case for the same pest, else a new `health` case (`source: "user"`, notes: "לא אומת") + `diagnosis` event; `event` treatment_started `{product, productActive, pest, healthCaseId, reportedBy: "user", verified: false}`; optional follow-up **inspection** `reminder` |
| move | plant `locationId` + `location_changed {from, to}` (skipped when already there) |
| reminder | `reminder` (kind inspect/custom, `nextAt` 08:00 local, not recurring) → Today |
| note | journal `note` event |

Where the records show (one record each — no copies; `shared/domain.ts`):
- **History** and **Journal** (יומן): the same `treatment_started` / `diagnosis` event. Health events are always part of the journal (`inJournal()`), so records stored before this rule (production card of 2026-10-18) appear too. Title "טיפול נגד אקריות", detail "חומר · דיווח שלך, לא אומת · נרשם דרך AI Botanist".
- **Health tab**: the case ("דיווח שלך · לא אומת") with its treatments; resolved per plant by the user.
- **"חולים"** (My Plants): plants marked sick OR with an open health case (`needsCarePlantIds`), derived from the cases — a seedling with mites stays a seedling; resolving the last open case removes it. A treatment never closes a case.
- **Updates**: the card's "צפייה בצמחים שעודכנו" → `/updates/{card}`: every confirmed plant with its stored event, case and reminder as found on the device (not the chat text); Today lists recent bulk updates as one entry each.
- **Today**: reminders of one card (`groupId`, or the same AI reminder text + time for older records) are ONE item with per-plant "בוצע" and "כולם בוצעו".
- **AI context**: events and cases of the plant (internal ids stripped).

## Incident 2026-10-18: "עודכנו 26 צמחים" but not visible
Read-only production check: the card (status done, 26 of 28 targets confirmed, follow-up chosen) had committed all records — 26 `treatment_started` events dated 13.10 (inHistory), 26 diagnosis events, 26 open user-reported health cases, 26 active inspection reminders; success message stored with the last batch; no failures, no orphans. The success count was true. The gaps were read-side: the journal showed only `inJournal` events (treatments were stored with `false`), "חולים" filtered on `plant.status === "sick"` only, History titled it "התחלת טיפול" without the pest, no way from the card to the plants, and 26 separate reminders would have hit Today. Fixed on the read side, so the existing records show without rewriting production data; nothing was replayed. New records also carry `payload.actionId`, `inJournal: true` and `reminder.groupId`.

## Safety
- Never a repeat pesticide application: the follow-up offered is an inspection reminder; a requested "לרסס שוב" reminder becomes "לבדוק … ולהחליט לפי התווית".
- Confidor/imidacloprid (and thiamethoxam) against spider mites: warning that it is usually ineffective and may worsen outbreaks (general knowledge, labelled as such); bee warning for outdoor places; pets warning when the profile has pets; "dose, intervals and safety only per the label". No dosage or interval is ever produced, and nothing claims a source was checked.
- Unknown products get only the label reminder.

## Tests
`tests/actions.test.ts` (dates, time zones/DST, matching, safety, allowlist), `tests/actions-api.test.ts` (one / named / all / location / status / exclusion / correction / ambiguity / backdating / duplicates / idempotency / concurrent confirm / partial failure / cancel / treatment + case reuse + follow-up / reminders → Today / soil check / move / cross-user isolation), `tests/e2e/actions.e2e.ts` (chat card, correction, list editing, confirm, cancel, History/Health/plant reminders; Chromium at iPhone size — a simulation, not a real iPhone). The model is mocked in tests; the Hebrew understanding of the real model is checked only live.

## Limits
- Understanding depends on the model; anything it can't map becomes a question or a normal chat answer, never a write.
- One action type per message ("השקיתי ודישנתי" → the parser picks one; say them separately).
- Up to 300 personal plants are listed to the parser.
- "בשבוע שעבר" without a day is read as 7 days ago (shown in the card before saving).

## Changing existing records (2026-10-18) — `src/worker/record-actions.ts`
Allowlisted record actions: `resolve_issue`, `remove_issue`, `delete_records`, `redate_records`, `edit_records`, `cancel_reminders`, `redate_reminders`, `undo`. Same pipeline as above: Claude parses only (record type, pest/product, the records' date, the corrected date/product/pest, "the last one", resolved vs. erroneous); plants come from the same scope resolution (named, duplicates, location, status, all); the records are matched deterministically among THIS user's live records; plants without a matching record are not shown.
- **Resolved vs. wrong:** "הצמח החלים" → the case is closed (`state: resolved`, `treatment_ended` event), kept in History/Health. "לא היו אקריות, הרישום היה טעות" → the case and its diagnosis event are removed, the inspection reminders for it cancelled, and the treatment STAYS (only its pest link is removed: `pest: null`, `pestCorrected`). Only "לא טיפלתי…" deletes a treatment (plus that treatment's own follow-up reminders); deleting a treatment never deletes the health issue. "תורידי את האקריות" without a reason → one question with the real count ("מצאתי 8 שתילים עם רישום אקריות. לסמן שהחלימו, או למחוק…?"); the answer completes the request.
- **Card:** each plant with its actual records and what happens to each (struck through when excluded), red border + "אישור ומחיקה" for deletions, the warning that it is recoverable.
- **Guarded updates:** every record change is "set these fields only if the record still has the values seen when the card was built" — a record edited in the meantime is reported ("השתנה מאז ולא נגעתי בו"), never overwritten. Deterministic mutation ids → a repeated confirm changes nothing. Chunks of ≤7 writes, atomic with the progress.
- **Soft delete:** `deletedAt`, `deletedBy`, `deletedVia` (the card). Every view and the AI context already hide deleted records; the row stays in D1 for audit and undo. Nothing is hard-deleted.
- **Undo:** every executed card stores `applied` (per record: created, or before/after). "תבטלי את מה שעשית" / "תחזירי את מה שמחקתי" / the "ביטול הפעולה" button on a finished card (`POST /api/v1/actions/undo`) → an undo CARD of the most recent committed, not-undone card; confirming reverses exactly those changes where the record is still as that card left it; the original card is marked `undoneBy`. Undoing the undo re-applies. Cards saved before the change log existed (the 2026-10-18 production card) are undone from their deterministic record ids; a legacy "move" card cannot restore the previous place (said in the card).
- **Effects:** History/Journal/Health/Sick/Today/AI context read the same records, so a removed case leaves Sick, a resolved one moves to past treatments, a re-dated watering moves the last-watered date and the soil-check plan, a cancelled reminder leaves Today.
- Tests: `tests/record-actions.test.ts` (14), `tests/e2e/record-actions.e2e.ts` (2).
