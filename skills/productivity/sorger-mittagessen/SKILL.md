---
name: sorger-mittagessen
description: >-
  Logs into Sorger Mittagessen (mittagessen.sorgerbrot.at), picks a date on the
  dish-selection page, lists allergen-safe options (no A/G), asks gateway users
  to confirm pre-order, then logs in again to order via per-row **+** buttons
  (multi-dish allowed), submits via qty field **1** + Enter; completes only after the
  green top banner „Die Bestellung für … wurde gespeichert.“
  Use for Sorger, Sorgerbrot, Mittagessen, lunch
  mail, or Telegram/email tasks about ordering.
version: 1.2.1
platforms: [linux, macos, windows]
required_environment_variables:
  - name: SORGER_USER
    prompt: Sorger Mittagessen login username
    help: Stored in the assignee profile .env; never put in task text.
  - name: SORGER_PASSWORD
    prompt: Sorger Mittagessen login password
    help: Stored in the assignee profile .env; never put in task text.
metadata:
  hermes:
    category: productivity
    tags: [sorger, lunch, browser, login, forms, ordering, allergens, gateway]
    related_skills: [kanban-worker]
---

# Sorger Mittagessen — Menu, Approval, and Pre-Order

Guides Hermes through **Sorger Mittagessen** end to end: login, **date selection**
on the dish page, **allergen-safe** options stored on the task, **user approval**
on gateway channels, then **pre-order** in the same browser flow and confirmation
on the ticket.

## Scope and Kanban routing

| Topic | Rule |
|-------|------|
| Sorger orders, login checks, mail about Mittagessen | Kanban board **`default`** |
| Schlummerpost content, wiki, social, campaigns | Board **`schlummerpost`** |

Create tasks with `board="default"` and `skills=["sorger-mittagessen"]`. Never use
the Schlummerpost board for Sorger work.

## CRITICAL — Login: `browser_type` does not read `$SORGER_*`

`browser_type(text="$SORGER_USER")` types the **literal characters**
`$`, `S`, `O`, `R`, `G`, `E`, `R`, `_`, `U`, `S`, `E`, `R` — **not** your username.
The site then always shows **„Der Login ist fehlgeschlagen.“** even when `.env` is
correct.

| Wrong (always fails) | Right |
|----------------------|--------|
| `text="$SORGER_USER"` | `terminal` → read output → `text="<that exact string>"` |
| `text="${SORGER_PASSWORD}"` | Same for password |
| Telling the user you used `${SORGER_USER}` | You did **not** use the env var — you typed its **name** |

**Before any login `browser_type`:** run the mandatory gate in
[Login credentials](#login-credentials--mandatory-terminal-gate). **After fill:**
snapshot must **not** show `$` or `SORGER_USER` inside the username field.

In `kanban_block` / user-facing text: never write `${SORGER_USER}` or
`${SORGER_PASSWORD}` — say „Anmeldedaten aus dem Profil-Environment (.env)“.

## Credentials and allergen policy

| Variable | Purpose |
|----------|---------|
| `SORGER_USER` | Login username |
| `SORGER_PASSWORD` | Login password |
| `SORGER_BASE_URL` | Optional; default `https://mittagessen.sorgerbrot.at` |
| `SORGER_EXCLUDE_ALLERGENS` | Optional; default `A,G` — comma-separated codes to **reject** |

Kanban workers inherit the dispatcher/gateway environment and load the profile
`.env` on startup — if `SORGER_*` is set there or in the parent process, it is
available without extra config.

- Credentials from the assignee profile's `~/.hermes/profiles/<name>/.env` and/or
  the host environment (e.g. systemd) — **not** in task title/body/comments.
  This skill's `required_environment_variables` registers passthrough for
  `terminal` / `execute_code` when you use the login steps below.

### Two buckets (do not invert)

| JSON field | Meaning | Offer to user? |
|------------|---------|----------------|
| **`eligible_dishes`** | Dish has **no A and no G** (may have other codes like O, M, B) | **Yes** — numbered options for Vorbestellung |
| **`excluded_dishes`** | Dish contains **A and/or G** | **No** — never list in the numbered offer |

Default policy `SORGER_EXCLUDE_ALLERGENS=A,G` means: user avoids **gluten (A)** and **… (G per site legend)** only.
**All other allergen letters stay orderable** and belong in `eligible_dishes` with their full code list.

### How Sorger shows allergens (per dish card)

Each dish is a **card** on the Speisen page, not a single line of text. Under the
price you must find:

```text
Allergene:  [A] [C]     ← round badges / letters after the label
```

Reference cards (**must be excluded** — never under „Bestellbar“ / numbered options):

| Dish | Line on card | `allergens` | Bucket | Policy hit |
|------|----------------|-------------|--------|------------|
| Salat Hendl | `Allergene: A C` | `["A", "C"]` | **`excluded_dishes`** | **A** |
| Brokkolicremesuppe | `Allergene: G O` | `["G", "O"]` | **`excluded_dishes`** | **G** |

If **Salat Hendl** or **Brokkolicremesuppe** (or any dish whose card shows **A** or
**G** badges) appears in `eligible_dishes` or in the numbered human comment, the
scout output is **wrong** — fix before `kanban_block`.

**G is a blocked code**, not “ignored because the dish name contains Brokkoli”.
The badge letter **G** on `Allergene:` is what matters.

Common failure: reading only the **dish title** (`Salat Hendl`, `Brokkolicremesuppe`) from the snapshot
and setting `allergens: []` because the **Allergene:** row is on the next line or
omitted in `full=false` snapshots. That wrongly offers A-containing dishes.

**Per dish, always:**

1. Locate the card for that exact dish name.
2. Read the **`Allergene:`** line on **that same card** (badges or plain letters).
3. Parse every letter `A`–`Z` after `Allergene:` (e.g. `A C` → `["A","C"]`,
   `A,G` → `["A","G"]`). Sort letters for stable JSON.
4. If the snapshot omits badges, use `browser_snapshot(full=true)` on that card
   or `browser_vision` with: “List dish name and all allergen letters on its card.”

Do **not** infer “no allergens” from missing data — re-snapshot first.

### Classification rule

For each dish on the menu for the chosen date:

1. `codes` = all letters from that dish’s **`Allergene:`** line (step 1–3 above).
2. `blocked = {A, G} ∩ codes` (policy letters from `SORGER_EXCLUDE_ALLERGENS`).
3. If `blocked` is non-empty → **`excluded_dishes`**, `reason`: `"contains A"`,
   `"contains G"`, or `"contains A and G"`.
4. If `blocked` is empty → **`eligible_dishes`** — even when `codes` is
   `["O"]`, `["M"]`, `["C"]`, or `[]`.
5. **Never** exclude only for O, M, C, etc. **Never** offer a dish whose `codes`
   includes **A** or **G**.

### Mandatory: run `partition_allergens.py` (do not hand-bucket)

Models often parse `allergens` correctly but still put **G** dishes in
`eligible_dishes` (e.g. Süßkartoffel-Moussaka `["G","O"]`, Paprikasuppe mit Chili
`["G","O"]` listed as „Bestellbar“). **Always** partition with the bundled script
after you have every dish’s `name` + `allergens` from the page:

1. Build a JSON array of **all** dishes (eligible-looking and excluded-looking —
   one flat list):

```json
{"dishes": [
  {"name": "Süßkartoffel-Moussaka …", "allergens": ["G", "O"]},
  {"name": "Kunterbunter Salat", "allergens": []},
  {"name": "Chili con Carne …", "allergens": ["O"]}
]}
```

2. Pipe through the script (from repo root or skill path):

```
terminal(command='cd <hermes-agent-root> && printf \'%s\' \'{"dishes":[...]}\' | python3 skills/productivity/sorger-mittagessen/scripts/partition_allergens.py')
```

3. Use **only** the script’s `eligible_dishes` / `excluded_dishes` in `sorger-menu`
   and in the human comment. **Ignore** any prior hand-sorted buckets.

4. If any `eligible_dishes[].allergens` contains `A` or `G`, the script was not
   used or input was wrong — fix before `kanban_block`.

Wrong (inverts policy — do not do this):

```json
"excluded_dishes": [{"name": "Chili con Carne", "allergens": ["O"], "reason": "contains O"}]
```

Correct:

```json
"eligible_dishes": [{"option": 3, "name": "Chili con Carne", "allergens": ["O"]}],
"excluded_dishes": [{"name": "Semmelknödel", "allergens": ["A", "G"], "reason": "contains A and G"}]
```

### Before `kanban_comment` (self-check)

- Confirm you ran **`partition_allergens.py`** — not manual sorting into buckets.
- Every **`eligible_dishes[].allergens`** must **not** contain `"A"` or `"G"`.
  Example failures: option 1 with `["G","O"]`, option 8 Paprikasuppe with `["G","O"]`
  under „Bestellbar“ — both belong in **`excluded_dishes`** only.
- Grep the numbered human comment: no line under „Bestellbar“ may show
  `Allergene: … G` or `… A` (e.g. `— Allergene: G, O` is **excluded**, not offered).
- Every `excluded_dishes[].allergens` must include **A or G**; `reason` must cite A/G.
- If any eligible row has `allergens: []` but you never saw `Allergene:` for that
  card, do **not** publish — snapshot/vision again.

## Required tools

**Browser** (mandatory): `browser_navigate`, `browser_snapshot`, `browser_click`,
`browser_type`, `browser_press`, `browser_console`, `browser_vision` if needed.

**Kanban** (mandatory): `kanban_comment`, `kanban_block`, `kanban_complete`,
`kanban_show` (read comments / prior metadata on resume).

**Messaging** (gateway approval): `send_message` — enable on the worker profile
when tasks may originate from Email, Telegram, Discord, Slack, etc.

## Browser session id

Use the **same** `task_id` on every `browser_*` call — the Kanban task id from
`$HERMES_KANBAN_TASK` (e.g. `t_a1b2c3`), not `"default"`:

```
browser_navigate(url="https://mittagessen.sorgerbrot.at", task_id="t_a1b2c3")
browser_snapshot(task_id="t_a1b2c3")
```

If you omit `task_id`, login and later steps may hit different browser sessions.

## Login credentials — mandatory terminal gate

`browser_type` has **no shell**. Only `terminal` expands `$SORGER_USER` / `$SORGER_PASSWORD`.

### Gate (run once per login attempt — before filling fields)

```bash
test -n "$SORGER_USER" && echo USER_OK || echo USER_MISSING
test -n "$SORGER_PASSWORD" && echo PASS_OK || echo PASS_MISSING
```

If **MISSING** → fix `~/.hermes/profiles/<assignee>/.env` or gateway env; `kanban_block`
with „SORGER_USER/SORGER_PASSWORD nicht im Worker-Environment“ — **do not** try login.

Then load secrets (tool output is for **you only** — never in `kanban_comment`):

```
terminal(command='printf "%s" "${SORGER_USER}"')
terminal(command='printf "%s" "${SORGER_PASSWORD}"')
```

- Output must be **non-empty** and must **not** equal the literal strings `SORGER_USER`,
  `$SORGER_USER`, or `${SORGER_USER}`.
- If empty → env not loaded; do not proceed.

### Fill login fields (pick one method)

**Method A — `browser_type` with values from terminal output** (separate calls):

```
browser_type(ref="@e2", text="<username copied from terminal — no $ character>")
browser_type(ref="@e3", text="<password copied from terminal>", task_id="t_a1b2c3")
```

**Forbidden** — will always fail login:

```
browser_type(ref="@e2", text="$SORGER_USER")
browser_type(ref="@e3", text="${SORGER_PASSWORD}")
browser_type(ref="@e2", text="SORGER_USER")
```

**Method B — `browser_console` fill** (often safer — paste real strings into JS once):

```javascript
(() => {
  const u = document.querySelector('input[type="text"], input:not([type="password"])');
  const p = document.querySelector('input[type="password"]');
  if (!u || !p) return "fields not found";
  u.value = "<username from terminal>";
  p.value = "<password from terminal>";
  u.dispatchEvent(new Event("input", { bubbles: true }));
  p.dispatchEvent(new Event("input", { bubbles: true }));
  return "filled";
})()
```

Replace `<username from terminal>` / `<password from terminal>` with the **actual**
characters from the `printf` output — never the text `SORGER_USER` or `$SORGER_*`.

### Verify fill before submit

`browser_snapshot()` on the login form:

- Username field must show the **real login name**, not `$`, not `SORGER_USER`, not
  `${SORGER_USER}`.
- If the field contains **`$` or `SORGER_`** → you used Method wrong; clear fields,
  re-run terminal gate, fill again. **Do not** blame „falsche Credentials“ yet.

Only after verification → [Login and consent](#login-and-consent) submit sequence.

## Login and consent

1. Datenschutz checkbox ≠ login submit — accept privacy (click/checkbox), then fill
   credentials (above).
2. **Submit login** — after both fields are filled, use this order (snapshot after
   each step; stop when the page changes away from the login form):

   **A. `form.requestSubmit()` first** (preferred — do not click the button yet):

   ```javascript
   (() => {
     const p = document.querySelector('input[type="password"]');
     const form = p && p.closest('form');
     if (!form) return 'no form';
     if (typeof form.requestSubmit === 'function') form.requestSubmit();
     else form.submit();
     return 'requestSubmit';
   })()
   ```

   Run via `browser_console` on the login page (same `task_id`).

   **B. Only if still on login** — `browser_click` on the visible login submit button
   (e.g. **Anmelden**, **Login**, **Einloggen**). Find its ref from `browser_snapshot`.

   **C. Only if A and B failed** — `browser_press(key="Enter")` while focus is in the
   password field.

   Do **not** click the login button before trying **A**. Do **not** skip **A** and
   go straight to the button.

3. After every step: `browser_snapshot()`; do not claim login (or order) success if
   the page is unchanged.

## CRITICAL — Vorbestellung: only the green save banner counts

A Sorger **Vorbestellung is not saved** until the site shows a **light-green banner at
the very top** of the Speisen page (above **„Meine Bestellungen“**) with text of the form:

```text
Die Bestellung für Montag, 08.06.2026 wurde gespeichert.
```

(Weekday and date vary; the sentence structure is fixed.)

| Agent assumption | Reality |
|------------------|---------|
| Quantity fields show **`1`** | Order may **not** be stored yet |
| **`+`** clicked, Enter pressed | Submit may have failed silently |
| Still on **„Meine Bestellungen“** / dish list | Normal page **after** save — **not** proof without the banner |
| User would see the order if they log in manually | **False** until the banner appeared in **your** snapshot |

**Never** `kanban_complete` with `ordered: true` or tell the user „vorbestellt“ unless the
**latest** `browser_snapshot()` after submit contains **`Die Bestellung für`** and
**`wurde gespeichert`** in that top banner (copy the full line into the ticket).

If the banner is missing: retry submit (qty **`1`** + Enter, then bottom button), snapshot
again. If still missing: `kanban_block` — order **failed**, not done.

---

## Dish selection page and date

After login, open the flow until you see:

**„Bitte wählen Sie die Speisen aus, die Sie gerne hätten.“**

On **this** screen (not before):

1. **Select the target date first** — use the date control on that page (dropdown,
   calendar, or day tabs). Pick the date from:
   - task body (e.g. `Datum: 2026-06-03`, `Dienstag`, `nächster Werktag`), or
   - if unspecified: the **next orderable weekday** (skip weekends if the UI only
     shows Mon–Fri).
2. `browser_snapshot()` — confirm the visible menu matches the chosen date
   (heading, day label, or URL change).
3. Parse **all dishes** for that date; classify per **Two buckets** above.

**Wrong page:** heading **„Meine Bestellungen“** is order history, not the daily menu.
Navigate back until you see **„Bitte wählen Sie die Speisen aus, die Sie gerne hätten.“**
before building `sorger-menu`. Do not scout from the Bestellungen list.

If the date control is not in the snapshot, try `browser_snapshot(full=true)` or
`browser_vision`, then click the correct day ref and snapshot again.

---

## Two-phase workflow (overview)

| Phase | Goal | Task state |
|-------|------|------------|
| **A — Scout** | Login, pick date, list safe options | Comment + metadata; **block** awaiting user |
| **B — Order** | User chose one or more options; login, `+` per row, qty **`1`** + Enter | **Complete** only after green top banner |

Same browser sequence in both phases: Datenschutz → Login → (Phase A: read menu;
Phase B: **`+`** per chosen row → click qty field **`1`** + **Enter** → verify save banner).

Detect Phase B when:

- Task is **unblocked** after a prior `awaiting-user` block, and/or
- Latest comment contains the user's choice (`1`, `Option 2`, exact dish name).

On Phase B, **do not** re-ask for approval unless the choice is ambiguous.

---

## Phase A — Scout: save options and ask (gateway)

### 1. Persist structured menu on the task

Write durable data **before** blocking (comments survive `kanban_block`; use both):

```python
import json
from datetime import date

payload = {
    "phase": "scout",
    "date_iso": "2026-06-03",
    "date_label": "Di 03.06.2026",
    "page_heading": "Bitte wählen Sie die Speisen aus, die Sie gerne hätten.",
    "eligible_dishes": [
        {"option": 1, "name": "Chili con Carne", "allergens": ["O"]},
        {"option": 2, "name": "Kunterbunter Salat", "allergens": []},
    ],
    "excluded_dishes": [
        {"name": "Salat Hendl", "allergens": ["A", "C"], "reason": "contains A"},
        {"name": "Brokkolicremesuppe", "allergens": ["G", "O"], "reason": "contains G"},
        {"name": "Weizennudeln mit Sauce", "allergens": ["A", "G"], "reason": "contains A and G"},
    ],
    "allergen_policy": {"exclude": ["A", "G"]},
}
kanban_comment(body="sorger-menu:\n" + json.dumps(payload, ensure_ascii=False, indent=2))
```

Also set the same object under `metadata.sorger` in the **next** `kanban_complete`
or store it in a comment only until complete — on scout you **block**, not complete.

Human-readable summary in a **second** `kanban_comment` (German). **Required:**
show **allergens next to every dish** in both sections — do not omit codes.

```text
Sorger Mittagessen — Vorbestellung für Di 03.06.2026?

Bestellbar (ohne A und G):
1) Kunterbunter Salat — Allergene: keine
2) Chili con Carne — Allergene: O

Nicht angeboten (enthält A oder G):
- Salat Hendl — Allergene: A, C (ausgeschlossen: A)
- Brokkolicremesuppe — Allergene: G, O (ausgeschlossen: G)
- Weizennudeln — Allergene: A, G (ausgeschlossen: A, G)

Antwort mit einer oder mehreren Nummern (z. B. `2`, `1 und 3`, `2,4`), exakten
Gerichtenamen, oder „nein“ / „keine Vorbestellung“. Mehrfachauswahl ist erlaubt.
```

Format rules for the human comment:

- **Eligible line:** `{n}) {name} — Allergene: {comma-separated codes}` or
  `Allergene: keine` when the card has no `Allergene:` line.
- **Excluded block:** bullet list with full codes from the card + `(ausgeschlossen: A)` /
  `(ausgeschlossen: G)` / `(ausgeschlossen: A, G)` matching policy hits.
- **Never** list an excluded dish (A or G present) under the numbered “Bestellbar” list.
- Mirror the same allergen strings as in JSON `allergens` arrays.

Use the same allergen lines in `send_message` when asking on gateway.

### 2. Gateway origin — ask the user

**Gateway-origin** means the task came from Email, Telegram, Discord, Slack,
WhatsApp, Signal, or another messaging surface (not only dashboard/CLI). Signals:

- Task body mentions gateway / platform / “aus Telegram” / “aus E-Mail”, or
- `created_by` is a gateway profile and the user expects a chat reply, or
- `/kanban create` from gateway (auto **notify_sub** — user gets terminal events).

For gateway-origin tasks **always**:

1. Post the numbered question (comment above).
2. Proactively message the user with `send_message` when the tool is available:
   - `send_message(action="list")` if you need `platform:chat_id`.
   - Prefer the **same channel** as the request: parse `Notify: telegram:123:thread`
     from the task body if present; else use `telegram`, `email`, etc. home target.
   - Message text = short German question + numbered options + task id
     (`t_…`) + hint: `Antwort hier oder: /kanban comment t_… "2"`.
3. `kanban_block` so the dispatcher stops until the user answers:

```python
kanban_block(
    reason="awaiting-user: Sorger Mittagessen — Vorbestellung? Option(en) im Kommentar (1–N, mehrere möglich, oder nein)",
)
```

The gateway notifier also delivers a **blocked** event to subscribed chats; the
`send_message` text should contain the **full menu**, not only the block reason.

**Non-gateway** (cron, dashboard, CLI only): still save menu in comments/metadata;
block with the same `awaiting-user` prefix unless the task body says
`auto_order: <name>` or `wahl: 2` / `wahl: 1,3` — then skip approval and run Phase B in one run.

### 3. If no eligible dishes

Comment why (**every** dish on the menu shows A or G, date closed, deadline passed).
Block with a clear reason; on gateway, `send_message` that no A/G-free option exists.
Dishes with only O/M/other allergens still count as eligible — that is not “no options”.

---

## Phase B — Order: user choice → pre-order → ticket

### 1. Parse the user's choice (single or multiple)

Read `kanban_show` → `comments` (newest first) and the Phase A `sorger-menu` payload.
Build a list **`choices`** — one entry per selected dish from `eligible_dishes` only.

| User says | Match |
|-----------|--------|
| `1`, `Option 1`, `Nr. 1` | one choice: `option: 1` |
| `1 und 3`, `1,3`, `ja 2 und 4` | multiple options (split on `,`, `und`, `&`, spaces) |
| `2x 1` / `zweimal 3` | same option twice → click **`+` twice** on that row (qty 2) |
| exact dish name | `name` (case-insensitive); multiple names if separated by `,` / `und` |
| `nein`, `keine`, `abbrechen` | Cancel — `kanban_complete` with `ordered: false` |

Reject any option that maps to `excluded_dishes` or has **A/G** in `allergens`.
If ambiguous, `kanban_block(reason="awaiting-user: Sorger — bitte Option 1–N (mehrere möglich) oder nein")`
and one clarifying `send_message` on gateway.

Store the resolved choices in a comment:

```python
kanban_comment(body='sorger-choice: {"choices": [{"option": 2, "name": "…", "qty": 1}, {"option": 4, "name": "…", "qty": 1}]}')
```

Default **`qty`: 1** per choice unless the user asked for more of the same option.

### 2. Browser pre-order

1. `browser_navigate` → Datenschutz → Login (submit rules above).
2. Open **„Bitte wählen Sie die Speisen aus, die Sie gerne hätten.“**
3. Select the **same date** as Phase A (`date_iso` / `date_label` from comments).
4. For **each** resolved choice, set quantity on **that dish’s row** via **`+`** (below).
5. **Submit the order** via the quantity field + **Enter** (below) — after the **last**
   selected row shows **`1`**.
6. `browser_snapshot()` — **hard gate:** green top banner **„Die Bestellung für … wurde
   gespeichert.“** (see CRITICAL section). No banner → **not** ordered.

Do **not** click only the dish title. Do **not** submit until every selected row shows
the required quantity. Do **not** complete the task because rows show **`1`** alone.

#### Quantity: always use the **`+` button** (never type into the field)

Each dish row/card has a quantity control on the right:

```text
[ − ]   1   [ + ]
        ↑       ↑
   qty field   use + to reach 1 — do NOT browser_type "1" to set quantity
```

For **each** dish in `sorger-choice.choices`:

1. `browser_snapshot()` — locate the **`+` button** on **that dish’s row** (same row as
   the dish name). Identify its ref (e.g. `@e12`).
2. Click **`+` once per portion** (default 1× `+` → quantity **1**; for `qty: 2` click
   **`+` twice**, snapshot between clicks if the UI only increments by one).
3. **Do not** use `browser_type` on the quantity field to **set** quantity — use **`+`**
   only. (Typing `1` is not how Sorger expects the count to change.)
4. `browser_snapshot()` — verify **that row** displays **`1`** (or the target qty).
   Unselected rows may stay at **`0`**.
5. Repeat for the next chosen dish until **all** choices are set.

Do **not** `kanban_complete` if any selected row still shows **`0`** when it should be **`1`**.

#### Submit: quantity field **`1`** + **Enter** (preferred)

After the **last** selected dish shows **`1`** in its quantity field (multi-dish:
finish every **`+`** first, then submit once):

1. `browser_snapshot()` — on the **last** dish you updated (final entry in
   `sorger-choice.choices`), find the **quantity input** in that row — the box
   between **`−`** and **`+`** that now displays **`1`**.
2. `browser_click` on that quantity field (focus the field showing **`1`** — do not
   click **`+`** or **`−`** here).
3. `browser_press(key="Enter")` (Return) to send/submit the order.
4. `browser_snapshot()` — look at the **top** for the save banner (below).

This is **not** typing `1` into the field — the value is already **`1`** from the **`+`**
steps. You only **click the field** and press **Enter**.

#### Submit fallback (only if Enter on qty field did not save)

If there is still no **„Die Bestellung für … wurde gespeichert“** banner:

1. `browser_snapshot(full=true)` — locate the **bottom** submit button (e.g.
   **Bestellen**, **Vorbestellen**, **Speichern**).
2. Try **`form.requestSubmit()`** on the order form via `browser_console`, then
   **`browser_click`** on that button, then **Enter** again.
3. `browser_snapshot()` — re-check the top banner.

#### Success verification (hard gate — required before `kanban_complete`)

**This is the only success signal.** Without it, the order does **not** exist in Sorger
(manual login will show **no** lunch order for that day).

After submit, take a fresh `browser_snapshot()` and confirm **all** of the following:

1. **Placement:** A **light-green** status strip at the **top** of the viewport (above the
   **„Meine Bestellungen“** heading), not only a row qty of **`1`**.
2. **Exact phrase (both parts required):**
   - starts with **`Die Bestellung für`**
   - ends with **`wurde gespeichert.`** (period optional)
3. **Copy the full banner line** from the snapshot into `metadata.sorger.verification`
   and the closing `kanban_comment` (verbatim — do not paraphrase).

Canonical examples from the live site (any of these formats count):

```text
Die Bestellung für Montag, 08.06.2026 wurde gespeichert.
Die Bestellung für Mo 08.06.2026 wurde gespeichert.
Die Bestellung für 08.06.2026 wurde gespeichert.
```

The weekday/date segment should match Phase A `date_label` / `date_iso` when readable.
If the banner names a **different** calendar day → treat as **failure** (wrong date tab).

**Does not count as success (common false positives):**

- Dish rows show quantity **`1`** but **no** green top banner
- Page title **„Meine Bestellungen“** visible without the save sentence
- You pressed Enter or clicked submit once — **no banner yet**
- Assuming the user will see the order when they log in — verify **in the browser first**
- Summarizing „Vorbestellt“ in `kanban_complete` without pasting the banner line from snapshot

**If the banner is missing:**

1. Retry: last row qty field **`1`** → **Enter**; snapshot again.
2. Fallback: bottom **Bestellen** / **Vorbestellen** / **Speichern** + snapshot.
3. Still missing → `kanban_block(reason="Sorger — Vorbestellung nicht gespeichert (kein Banner „… wurde gespeichert“)", …)` with snapshot excerpt; **`ordered: false`** or omit complete.

**Only then** call `kanban_complete` with `ordered: true`.

### 3. Save and confirm on the ticket

```python
# Run ONLY after snapshot shows the green top banner (hard gate above).
kanban_complete(
    summary="Sorger vorbestellt: <n> Gericht(e) am <date_label> — <exact banner line>",
    metadata={
        "site": "mittagessen.sorgerbrot.at",
        "sorger": {
            "date_iso": "2026-06-08",
            "date_label": "Mo 08.06.2026",
            "ordered": True,
            "dishes": [
                {"option": 2, "name": "…", "allergens": ["O"], "qty": 1},
            ],
            "allergen_policy": {"exclude": ["A", "G"]},
            "verification": "Die Bestellung für Montag, 08.06.2026 wurde gespeichert.",
        },
    },
)
```

`metadata.sorger.verification` must be the **exact** banner text from the snapshot, not
a template or guess.

Add a final `kanban_comment` listing every ordered dish with allergens, e.g.:

```text
✓ Vorbestellt (Sorger-Bestätigung):
Die Bestellung für Montag, 08.06.2026 wurde gespeichert.

Gerichte:
- Chili con Carne — Allergene: O
```

On **gateway**, `send_message` must include the **same banner line** — not „Bestellung
erfolgt“ without the Sorger save text.

If order failed after user approval: `kanban_block` with specifics; do **not**
`kanban_complete` with `ordered: true` until the green banner is in the snapshot or the
user explicitly accepts abort (`ordered: false`).

---

## Task body template (orchestrator / gateway)

```markdown
Ziel: Sorger Mittagessen prüfen und ggf. vorbestellen.
Datum: 2026-06-03
Quelle: gateway telegram
Notify: telegram:<chat_id>:<thread_id>
Allergene ausschließen: A, G
```

`Notify:` helps Phase A `send_message` routing. Gateway `/kanban create` still
auto-subscribes the originating chat when `Notify:` is omitted.

---

## Cron / mail-driven tasks

1. Board **`default`**, skill **`sorger-mittagessen`**, browser + send_message on profile.
2. Mail subject/body → task title/body with target date.
3. Default path: Phase A → user approval → Phase B after `unblock` + comment.
4. Fully unattended only when body includes explicit `auto_order:` or `wahl:` (single or multiple).

---

## Anti-patterns

- Selecting a dish before choosing the date on the Speisen-auswählen page
- Typing **`1`** into the quantity field (`browser_type`) instead of clicking **`+`**
- Clicking only the dish title without **`+`** on that row
- Leaving any **selected** row at **`0`** and submitting
- Submitting before every selected row shows **`1`** (or requested qty)
- Submitting only via the bottom button **without** trying qty field **`1`** + **Enter** first
- Pressing Enter before every selected row shows **`1`**
- Using `browser_type` to **set** quantity (use **`+`**); confusing that with submit click on **`1`**
- `kanban_complete` / „vorbestellt“ without green top banner **„Die Bestellung für … wurde gespeichert.“**
- Telling the user the order is done when manual login would show **no** order (banner never verified)
- `verification` in metadata that is a placeholder (`…`) instead of snapshot copy
- Only ordering one dish when the user selected **multiple** options
- Putting dishes with **only** O/M/other codes in `excluded_dishes` (only **A/G** go there)
- Putting dishes with **A** or **G** in `eligible_dishes` (e.g. **Salat Hendl** `A C`, **Brokkolicremesuppe** `G O`)
- Treating **G** badge as safe because only **A** was remembered
- `allergens: []` without reading the **`Allergene:`** row on that dish card
- Human comment without `— Allergene: …` beside each dish name
- Scouting from **„Meine Bestellungen“** instead of the Speisen-auswählen page
- `kanban_complete` after scout without user choice (unless `auto_order` / `wahl`)
- `browser_type` with `$SORGER_USER` / `$SORGER_PASSWORD` (shell syntax is not expanded)
- Credentials or passwords in comments
- Assuming gateway users saw options without `send_message` or a clear comment list
- Wrong Kanban board (`schlummerpost`)
- `curl` / `web_extract` instead of browser for login and order
- Login: clicking **Anmelden** before `form.requestSubmit()` — always **requestSubmit** first
- Any `browser_type` text containing `$`, `SORGER_USER`, or `SORGER_PASSWORD` as literal input
- Writing `${SORGER_USER}` / `${SORGER_PASSWORD}` in block reasons or user messages

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| Menu empty after date change | Reselect date; snapshot; check weekend/holiday |
| User reply not visible | `kanban_show`; ensure user used comment or unblock path |
| Blocked but user answered | Orchestrator/user: `/kanban comment t_… "2"` then `/kanban unblock t_…` |
| Same page after login | `requestSubmit` first, then login button click, then Enter; snapshot each step |
| `send_message` fails | `action=list`; use `Notify:` from body; rely on block notifier + comment |
| Login fields show `$SORGER_USER` | Typed variable **name**, not value — `terminal` + `printf`, then real strings only |
| „Login fehlgeschlagen“ + you cited `${SORGER_USER}` | Proof of bug — re-login with terminal gate; never mention `${…}` to user |
| `USER_MISSING` / empty `printf` | Set `SORGER_*` in profile `.env`; restart worker; skill registers passthrough |
| `SORGER_*` empty in `terminal` | Set in profile `.env` or gateway env; ensure skill is loaded (registers passthrough) |
| `excluded` lists O/M only; `eligible` all `[]` | Inverted or wrong page — re-read rules; use Speisen page; O/M → eligible |
| A/G dishes still in numbered list | Re-run `partition_allergens.py`; never hand-bucket; Moussaka/Paprikasuppe with G → excluded only |
| JSON has G in `eligible_dishes` | Script skipped — any `allergens` with G or A must not be in eligible; re-partition |
| Order “done” but row still `0` | Click **`+`** on that row (not `browser_type`), verify `1`, then qty field + **Enter** |
| Agent said vorbestellt, manual login empty | False complete — banner was never in snapshot; re-run Phase B; never `ordered: true` without banner |
| No save banner after submit | Click last row’s qty field showing `1`, **Enter**; then bottom button / `requestSubmit`; snapshot top |
| Enter did nothing | Snapshot: all chosen rows at `1`? Focus correct field (between −/+), not dish title |
| Rows at `1`, no green strip | Not saved — need top text „Die Bestellung für … wurde gespeichert.“ |
| Typed `1` but UI ignored it | Use **`+`** only; re-verify row shows `1` |

---

## Optional memory

```text
ops:sorger: order deadline Tue 10:00 Europe/Vienna
```

No passwords or full order history in memory — use task comments and `metadata.sorger`.
