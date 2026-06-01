---
name: sorger-mittagessen
description: >-
  Logs into Sorger Mittagessen (mittagessen.sorgerbrot.at), picks a date on the
  dish-selection page, lists allergen-safe options (no A/G), asks gateway users
  to confirm pre-order, then logs in again to place the order and records the
  result on the Kanban task. Use for Sorger, Sorgerbrot, Mittagessen, lunch
  mail, or Telegram/email tasks about ordering.
version: 1.1.1
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
- **Eligible dishes:** any option **without** excluded allergen codes (default **A**
  and **G**). If a line shows `(A)`, `A, G`, `Allergene: A G`, or legend markers
  **A** / **G** on that dish, **exclude** it and record why in `excluded_dishes`.
- When in doubt, exclude and list the dish under excluded rather than offering it.

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
3. Parse **all dishes** shown for that date; split into `eligible_dishes` and
   `excluded_dishes` per allergen rules above.

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
        {"option": 1, "name": "…", "allergens": []},
        {"option": 2, "name": "…", "allergens": ["B"]},
    ],
    "excluded_dishes": [
        {"name": "…", "allergens": ["A", "G"], "reason": "contains A or G"},
    ],
    "allergen_policy": {"exclude": ["A", "G"]},
}
kanban_comment(body="sorger-menu:\n" + json.dumps(payload, ensure_ascii=False, indent=2))
```

Also set the same object under `metadata.sorger` in the **next** `kanban_complete`
or store it in a comment only until complete — on scout you **block**, not complete.

Human-readable summary in a second comment (German, for humans and gateway):

```text
Sorger Mittagessen — Vorbestellung für Di 03.06.2026?

Ohne Allergene A/G:
1) …
2) …

Antwort mit Nummer (z. B. 1), „ja 2“, oder exaktem Gerichtename.
Oder: „nein“ / „keine Vorbestellung“.
```

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

Comment why (all dishes have A/G, date closed, deadline passed). Block with a clear
reason; on gateway, `send_message` that no safe option exists — do not offer a fake
choice.

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
4. Select the chosen dish (checkbox, radio, or row click per snapshot).
5. Submit/confirm the order (site-specific **Bestellen**, **Speichern**, **Weiter**).
6. `browser_snapshot()` — verify confirmation text or “bestellt” / order summary.

### 3. Save and confirm on the ticket

```python
kanban_complete(
    summary="Sorger vorbestellt: <name> am <date_label> (ohne A/G).",
    metadata={
        "site": "mittagessen.sorgerbrot.at",
        "sorger": {
            "date_iso": "2026-06-03",
            "ordered": True,
            "dish": {"option": 2, "name": "…"},
            "allergen_policy": {"exclude": ["A", "G"]},
            "verification": "confirmation snapshot: …",
        },
    },
)
```

Add a final `kanban_comment` with the same facts in plain German for humans.

On **gateway**, send confirmation:

```text
✓ Sorger vorbestellt: <Gericht> am <Datum>. (Task t_…)
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
- Offering dishes with **A** or **G** allergens
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

---

## Optional memory

```text
ops:sorger: order deadline Tue 10:00 Europe/Vienna
```

No passwords or full order history in memory — use task comments and `metadata.sorger`.
