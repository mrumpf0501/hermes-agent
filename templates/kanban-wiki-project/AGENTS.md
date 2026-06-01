# Schlummerpost — Projekt-Agenten (Kanban + Wiki)

> **Installation:** Diese Datei gehört in den **Board-`default_workdir`**, nicht ins
> Hermes-Repo. Auf dem Pi z. B.:
>
> ```bash
> PROJECT=/home/pi/projects/schlummerpost
> mkdir -p "$PROJECT"
> cp templates/kanban-wiki-project/AGENTS.md "$PROJECT/AGENTS.md"
> cp -r templates/kanban-wiki-project/docs "$PROJECT/"
> hermes kanban boards set-default-workdir schlummerpost "$PROJECT"
> ```
>
> Passe Pfade und Board-Slug unten an, falls du andere Namen nutzt.

## Geltungsbereich

| Konzept | Wert (anpassen) |
|---------|------------------|
| Kanban-Board | `schlummerpost` |
| Projekt-Root (`dir:`-Workspace) | `/home/pi/projects/schlummerpost` |
| Wiki | `docs/wiki/` unter dem Projekt-Root |
| Tenants | Namespace **innerhalb** des Boards (z. B. `content`, `ops`, `product`) — kein Ersatz für ein anderes Board |

**Board** = harte Grenze (eigene Queue, eigene DB). **Tenant** = Filter + Memory-Prefix. **Dokumentation** = Dateien im `dir:`-Workspace, nicht nur Kanban-Kommentare.

---

## Workspace-Regeln

| Art | Verhalten | Wann nutzen |
|-----|-----------|-------------|
| `dir:<absoluter Pfad>` | Persistiert; andere Tasks lesen mit | **Standard** für Wiki, Code, geteilte Artefakte |
| `worktree:` | Git-Arbeitsbaum | Code mit Branch/Commit |
| `scratch` | Wird bei Task-Ende gelöscht | Nur Wegwerf-Prototypen — **nie** Wiki oder Kanon-Doku |

- Workspace-Pfad muss **absolut** sein (z. B. `/home/pi/projects/schlummerpost`).
- Kind-Tasks vom Orchestrator: immer gleicher `dir:`-Pfad und passender `--tenant`.
- Ohne expliziten Pfad übernehmen Tasks mit `dir`/`worktree` die Board-`default_workdir`.

---

## Wikipedia (`docs/wiki/`)

Der **kanonische Informationsstand** lebt in Markdown unter `docs/wiki/`. Das Kanban-Board ist Workflow; die Wiki-Dateien sind Wissensbasis.

### Pflicht bei inhaltlichen Änderungen

Wenn du **Fakten, Prozesse oder Entscheidungen** am Projektstand änderst:

1. Betroffene Seite(n) unter `docs/wiki/` anlegen oder aktualisieren.
2. `docs/wiki/README.md` als Inhaltsverzeichnis pflegen (kurzer Überblick + Links).
3. Jede Wiki-Seite mit YAML-Frontmatter (siehe Schema unten).
4. In `kanban_complete`: kurzes `summary` + in `metadata` z. B. `docs_changed: ["docs/wiki/seite.md"]`.
5. Bei größeren oder strittigen Änderungen zusätzlich `kanban_comment` mit Dateipfad und Begründung.

### Frontmatter-Schema

```yaml
---
title: Menschenlesbarer Titel
tenant: content          # optional; leer lassen wenn board-weit
updated_at: 2026-05-31   # ISO-Datum des letzten inhaltlichen Updates
sources:
  - task: t_abc12345
    action: created      # created | updated | reviewed | superseded
  - task: t_def67890
    action: updated
---
```

- **`sources`:** Jede inhaltliche Wiki-Änderung durch diesen Task eintragen (aktuelle Task-ID aus `$HERMES_KANBAN_TASK` oder `kanban_show`).
- **`superseded`:** Alte Aussage durch neuen Stand ersetzt; kurz im Fließtext vermerken, was obsolet ist.
- Keine Task-ID erfinden — nur IDs, die wirklich existieren.

### Was nicht in die Wiki gehört

- Rohe Logs, Terminal-Dumps → `work/` oder Task-Kommentare.
- Einmalige Notizen ohne Projektbezug → `scratch` oder Kommentar, nicht `docs/wiki/`.

---

## Memory (ergänzend, nicht Ersatz für Wiki)

Persistent Memory nur für **kurze, wiederverwendbare Fakten**, mit Prefix:

```text
schlummerpost:<tenant>: <Fakt>
```

Beispiele:

- `schlummerpost:content: Veröffentlichungsfenster Di–So`
- `schlummerpost:ops: Backup läuft um 03:00 Europe/Berlin`

**Nicht** ganze Wiki-Artikel oder lange Prosa in Memory schreiben — dafür ist `docs/wiki/`.

---

## Kanban-Handoffs

- **Lesen vor Arbeit:** `kanban_show` — Titel, Body, Kommentar-Thread, ggf. Parent/Children.
- **Zwischenstand:** `kanban_comment` für Reviewer und Folge-Tasks.
- **Abschluss:** `kanban_complete` mit strukturiertem `metadata`, z. B.:

```json
{
  "docs_changed": ["docs/wiki/produkt.md"],
  "tenant": "content",
  "notes": "Kurz was sich geändert hat"
}
```

- **Mensch nötig:** `kanban_block` mit klarem `reason` — nicht `clarify` (headless Worker).
- **Review vor Done:** Bei Code/Doku mit Review-Pflicht zuerst `kanban_comment` mit Details, dann `kanban_block(reason="review-required: …")`.

### Aufgaben-Typen (nicht verwechseln)

| Ziel | Werkzeug |
|------|----------|
| Karte auf Board **Schlummerpost** | `kanban_create` / `hermes kanban create` / `/kanban create` |
| Externes **Linear.app** | Nur mit `LINEAR_API_KEY` und Linear-Skill — **nicht** für dieses Board |

---

## Orchestrator (wenn du zerlegst)

Beim Anlegen von Kind-Tasks im Body festhalten:

```text
workspace_kind=dir
workspace_path=/home/pi/projects/schlummerpost
tenant=<passend>
Wiki-Änderungen nur unter docs/wiki/ mit sources-Frontmatter.
```

Der Orchestrator führt die Arbeit nicht selbst aus — er routet nur.

---

## Verzeichnisstruktur (Zielbild)

```text
/home/pi/projects/schlummerpost/
├── AGENTS.md                 # diese Datei
├── docs/
│   ├── wiki/
│   │   ├── README.md         # Index + „Stand der Dinge“
│   │   └── …                 # thematische Seiten
│   └── decisions/            # optional: ADRs
└── work/                     # Task-Artefakte, Drafts, Skripte
```

---

## Im Dashboard lesen

Nach `hermes dashboard` → Tab **Kanban** → Toolbar **Docs**: zeigt
`docs/wiki/` aus der Board-`default_workdir` (Markdown, inkl. Task-Links aus
Frontmatter `sources`). Voraussetzung: `default_workdir` gesetzt und Wiki-Dateien
angelegt.

---

## Kurz-Checkliste vor `kanban_complete`

- [ ] Wiki aktualisiert, falls sich der Projektstand geändert hat?
- [ ] `sources` in Frontmatter mit aktueller `t_…`-ID?
- [ ] `metadata.docs_changed` gesetzt?
- [ ] Memory nur für kurze Fakten mit `schlummerpost:<tenant>:`-Prefix?
- [ ] Kein wichtiger Output nur in `scratch` gelandet?
