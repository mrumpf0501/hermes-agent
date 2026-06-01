---
name: sorger-mittagessen
description: >-
  Logs into Sorger Mittagessen (mittagessen.sorgerbrot.at), picks a date on the
  dish-selection page, lists allergen-safe options (no A/G), asks gateway users
  to confirm pre-order, then logs in again to place the order and records the
  result on the Kanban task. Use for Sorger, Sorgerbrot, Mittagessen, lunch
  mail, or Telegram/email tasks about ordering.
version: 1.1.5
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

- Re-scan every **`eligible_dishes`** row: if the card shows badge **A** or **G**
  → move to `excluded_dishes` (e.g. **Salat Hendl** + A; **Brokkolicremesuppe** + G).
- Grep the numbered human comment for known bad names (**Salat Hendl**,
  **Brokkolicremesuppe**) or for `— Allergene: …` lines that include **A** or **G**.
- Every `excluded_dishes[].allergens` must include **A or G**. If not → move to `eligible_dishes`.
- Every `eligible_dishes[].allergens` must **not** contain `"A"` or `"G"`.
- `reason` in `excluded_dishes` must mention **A or G**, never only O/M/C/other.
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

## Login credentials — do not use `$SORGER_*` in `browser_type`

`browser_type(text=...)` sends **exactly** the string you pass. It does **not**
run a shell — `text="$SORGER_USER"` types the eleven characters
`$`, `S`, `O`, `R`, `G`, `E`, `R`, `_`, `U`, `S`, `E`, `R` into the form. That
is a common failure mode.

**Never:**

```
browser_type(ref="@e2", text="$SORGER_USER")
browser_type(ref="@e3", text="$SORGER_PASSWORD")
```

### Recommended: read env, then `browser_type` real values

After `browser_snapshot` gives refs for username and password fields:

1. Read credentials (values must appear in tool output — do not paste them into
   comments or task text):

```
terminal(command='printf "%s" "${SORGER_USER}"')
terminal(command='printf "%s" "${SORGER_PASSWORD}"')
```

2. Use the **returned strings** (not `$SORGER_…`) in separate `browser_type` calls:

```
browser_type(ref="@e2", text="<actual username from step 1>")
browser_type(ref="@e3", text="<actual password from step 2>", task_id="t_a1b2c3")
```

If `SORGER_PASSWORD` is empty in terminal output, the variable is missing in the
worker environment or was stripped — fix profile `.env` / gateway env; loading
this skill should register passthrough for `SORGER_PASSWORD`.

### Alternative: `browser_console` fill (same snapshot refs)

After you have the real username and password strings (via `terminal` above),
set fields in the page without re-typing through `browser_type`:

```javascript
(() => {
  const u = document.querySelector('input[type="text"], input:not([type="password"])');
  const p = document.querySelector('input[type="password"]');
  if (!u || !p) return "fields not found";
  u.value = "<actual username>";
  p.value = "<actual password>";
  u.dispatchEvent(new Event("input", { bubbles: true }));
  p.dispatchEvent(new Event("input", { bubbles: true }));
  return "filled";
})()
```

Replace the placeholders with the real values from `printenv` / `printf` — not
`$SORGER_USER`.

## Login and consent

1. Datenschutz checkbox ≠ login submit — accept privacy, then fill credentials
   (above), then submit.
2. Submit login: button → `browser_press("Enter")` → `form.requestSubmit()` in
   `browser_console`.
3. After every step: `browser_snapshot()`; do not claim login or order success if
   the page unchanged.

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
| **B — Order** | User chose an option; login, select dish, confirm order | **Complete** with final metadata + comment |

Same browser sequence in both phases: Datenschutz → Login → (Phase A: read menu;
Phase B: select dish + submit order).

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

Antwort mit Nummer (z. B. 1), „ja 2“, oder exaktem Gerichtename.
Oder: „nein“ / „keine Vorbestellung“.
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
    reason="awaiting-user: Sorger Mittagessen — Vorbestellung? Optionen im Task-Kommentar (1–N oder nein)",
)
```

The gateway notifier also delivers a **blocked** event to subscribed chats; the
`send_message` text should contain the **full menu**, not only the block reason.

**Non-gateway** (cron, dashboard, CLI only): still save menu in comments/metadata;
block with the same `awaiting-user` prefix unless the task body says
`auto_order: <name>` or `wahl: 2` — then skip approval and run Phase B in one run.

### 3. If no eligible dishes

Comment why (**every** dish on the menu shows A or G, date closed, deadline passed).
Block with a clear reason; on gateway, `send_message` that no A/G-free option exists.
Dishes with only O/M/other allergens still count as eligible — that is not “no options”.

---

## Phase B — Order: user choice → pre-order → ticket

### 1. Parse the user's choice

Read `kanban_show` → `comments` (newest first). Map to an `eligible_dishes` entry:

| User says | Match |
|-----------|--------|
| `1`, `Option 1`, `Nr. 1` | `option: 1` |
| `ja, 2`, `bitte 2` | `option: 2` |
| exact dish name | `name` (case-insensitive) |
| `nein`, `keine`, `abbrechen` | Cancel — `kanban_complete` with `ordered: false` |

If ambiguous, `kanban_block(reason="awaiting-user: Sorger — bitte Option 1–N oder Gerichtename")`
and one clarifying `send_message` on gateway.

Store the resolved choice in a comment:

```python
kanban_comment(body='sorger-choice: {"option": 2, "name": "…"}')
```

### 2. Browser pre-order (same flow as before)

1. `browser_navigate` → Datenschutz → Login (submit rules above).
2. Open **„Bitte wählen Sie die Speisen aus, die Sie gerne hätten.“**
3. Select the **same date** as Phase A (`date_iso` / `date_label` from comments).
4. On the **chosen dish’s card/row**, set quantity **1** (see below) — do not stop
   at clicking the dish name alone.
5. **Submit the order form** for the whole page (see below) — not only the quantity row.
6. `browser_snapshot()` — verify confirmation text or “bestellt” / order summary.

#### Quantity: `1` in the field between `−` and `+`

Each dish row/card has a quantity control on the right:

```text
[ − ]   0   [ + ]
        ↑
   number field (often shows 0 before ordering)
```

For the **user-selected dish only**:

1. `browser_snapshot()` — find the **quantity input** on **that dish’s row** (between
   the minus and plus buttons). It may be a `spinbutton`, `textbox`, or numeric input.
2. Set the value to **`1`**:
   - Prefer `browser_type(ref="@e…", text="1")` on that field (clears/replaces like fill), or
   - `browser_click` the field, then `browser_type` `1`, or
   - One `browser_click` on **`+`** only if the snapshot proves `0` → `1` and the
     field is not directly typable.
3. `browser_snapshot()` — confirm **that row** shows **`1`**, not `0`. Other dishes
   may stay at `0`.

Do **not** `kanban_complete` if the chosen row still shows `0`.

#### Submit the order form

After quantity is **1** for the chosen dish:

1. `browser_snapshot()` — locate the page’s **order submit** control (e.g.
   **Bestellen**, **Vorbestellen**, **Speichern**, **Weiter**, or a form submit button).
2. Submit using the same rules as login:
   - **A.** `browser_click` on the submit button ref
   - **B.** `browser_press(key="Enter")` if focus is in the form
   - **C.** `browser_console` → `form.requestSubmit()` if A/B fail
3. `browser_snapshot()` — page must change (confirmation, “Meine Bestellungen”, or
   success message). Unchanged page = order **not** done; retry or `kanban_block`.

### 3. Save and confirm on the ticket

```python
kanban_complete(
    summary="Sorger vorbestellt: <name> am <date_label> (ohne A/G).",
    metadata={
        "site": "mittagessen.sorgerbrot.at",
        "sorger": {
            "date_iso": "2026-06-03",
            "ordered": True,
            "dish": {"option": 2, "name": "…", "allergens": ["O"]},
            "allergen_policy": {"exclude": ["A", "G"]},
            "verification": "confirmation snapshot: …",
        },
    },
)
```

Add a final `kanban_comment` with allergens on the ordered dish, e.g.:

```text
✓ Vorbestellt: Chili con Carne — Allergene: O — am Di 03.06.2026
```

On **gateway**, send confirmation:

```text
✓ Sorger vorbestellt: Chili con Carne — Allergene: O — am Di 03.06.2026 (Task t_…)
```

Use `send_message` to the same target as Phase A. Subscribers also receive the
gateway **completed** notifier with your summary line.

If order failed after user approval: `kanban_block` with specifics; do not
`kanban_complete` until verified or user accepts abort.

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
4. Fully unattended only when body includes explicit `auto_order:` or `wahl:`.

---

## Anti-patterns

- Selecting a dish before choosing the date on the Speisen-auswählen page
- Clicking only the dish title without setting quantity **`1`** between `−` and `+`
- Leaving quantity at **`0`** and submitting the form
- Submitting before the chosen row shows **`1`**
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

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| Menu empty after date change | Reselect date; snapshot; check weekend/holiday |
| User reply not visible | `kanban_show`; ensure user used comment or unblock path |
| Blocked but user answered | Orchestrator/user: `/kanban comment t_… "2"` then `/kanban unblock t_…` |
| Same page after login | Re-snapshot; Enter / `requestSubmit` |
| `send_message` fails | `action=list`; use `Notify:` from body; rely on block notifier + comment |
| Login fields show `$SORGER_USER` | Used `browser_type` with shell syntax — use `terminal` + real strings (see above) |
| `SORGER_*` empty in `terminal` | Set in profile `.env` or gateway env; ensure skill is loaded (registers passthrough) |
| `excluded` lists O/M only; `eligible` all `[]` | Inverted or wrong page — re-read rules; use Speisen page; O/M → eligible |
| A/G dishes still in numbered list | Re-read `Allergene:` per card; Salat Hendl (A), Brokkolicremesuppe (G) → excluded; fix comment |
| Order “done” but row still `0` | Set quantity field to `1` on chosen row, then submit form again |

---

## Optional memory

```text
ops:sorger: order deadline Tue 10:00 Europe/Vienna
```

No passwords or full order history in memory — use task comments and `metadata.sorger`.
