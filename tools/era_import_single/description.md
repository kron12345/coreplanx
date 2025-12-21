Ja 👍
Hier ist **die komplette Datei in *einem Stück***, exakt so, dass du sie **1× kopieren und als `.md` speichern** kannst.
Keine Abhängigkeiten, keine Verweise nach außen – **100 % offline-fähig**.

---

```markdown
# ERA Knowledge Graph Dump – Offline Single-File Beschreibung & Import-Spezifikation

> **Ziel:** Diese eine Markdown-Datei beschreibt vollständig den aktuellen ERA Knowledge Graph Dump,
> sodass ein Import **ohne Internetquellen** möglich ist.
>
> **Aktueller Stand:** Der Dump wird als **eine einzige Datei** bereitgestellt:
> `*.nq.xz` (XZ-komprimierte **N-Quads**).

---

## 1) Datei & Format

### 1.1 Dateityp
- **Datei:** `*.nq.xz`
- **Kompression:** XZ
- **Inhalt:** N-Quads (`.nq`)
- **Größe:** sehr groß (entpackt mehrere GB möglich)

**Wichtig:**  
Die Datei darf **nicht vollständig entpackt oder in den RAM geladen** werden.

---

### 1.2 Parsing-Regel (zwingend)
- Datei **streamend** lesen (z. B. `lzma.open(path, "rb")`)
- **Kein vollständiges Dekomprimieren**
- **Kein In-Memory-Graph**
- Zeile für Zeile bzw. Quad für Quad verarbeiten

---

### 1.3 N-Quads Format (Kurzbeschreibung)

Jede Zeile ist ein **Quad**:

```

<subject> <predicate> <object> <graph> .

```

- `subject`: IRI (`<...>`) oder Blank Node (`_:b123`)
- `predicate`: IRI (`<...>`)
- `object`:
  - IRI (`<...>`)
  - oder Literal (`"..."`, optional `@lang` oder `^^<datatypeIRI>`)
- `graph`: Named Graph (für MVP ignorieren)
- Zeile endet mit `.`

**Beispiel – Typisierung:**
```

[http://example/op/123](http://example/op/123)
[http://www.w3.org/1999/02/22-rdf-syntax-ns#type](http://www.w3.org/1999/02/22-rdf-syntax-ns#type)
[http://data.europa.eu/949/OperationalPoint](http://data.europa.eu/949/OperationalPoint)
[http://graph/x](http://graph/x) .

```

**Beispiel – Label mit Sprache:**
```

[http://example/op/123](http://example/op/123)
[http://www.w3.org/2000/01/rdf-schema#label](http://www.w3.org/2000/01/rdf-schema#label)
"Basel SBB"@de
[http://graph/x](http://graph/x) .

````

---

## 2) Relevante IRIs (offline, exakt matchen)

### 2.1 RDF / RDFS

- **rdf:type**
  - `http://www.w3.org/1999/02/22-rdf-syntax-ns#type`
- **rdfs:label**
  - `http://www.w3.org/2000/01/rdf-schema#label`

---

### 2.2 ERA Namespace

- **Basis-IRI**
  - `http://data.europa.eu/949/`

- **Operational Point (Klasse)**
  - `http://data.europa.eu/949/OperationalPoint`

- **inCountry (Property)**
  - `http://data.europa.eu/949/inCountry`

**Matching-Regel:**
- Primär: **exakter String-Vergleich**
- Optionaler Fallback:
  - `startsWith("http://data.europa.eu/949/")`
  - und `endsWith("/OperationalPoint")`

---

## 3) Ziel-Entität (MVP)

### 3.1 Operational Points (OP)

Ein Subject ist ein **Operational Point**, wenn mindestens ein Quad existiert:

- `predicate == rdf:type`
- `object == era:OperationalPoint`

---

### 3.2 Persistenz in Postgres

- `op_uri` = Subject-IRI (String)
- `data` = JSONB mit optionalen Feldern:
  - `label`
  - `country`
  - `country_code`

---

### 3.3 Label-Auswahl (deterministisch, offline)

Wenn mehrere `rdfs:label` existieren:

1. Bevorzuge Label mit Sprach-Tag `@de`
2. sonst `@en`
3. sonst erstes gefundenes Label

Optional erweiterbar:

```json
{
  "label": "Basel SBB",
  "labels": {
    "de": "Basel SBB",
    "en": "Basel SBB"
  }
}
````

---

### 3.4 Country-Wert

* `era:inCountry` ist eine **IRI**, z. B.:

  * `http://publications.europa.eu/resource/authority/country/CHE`

Speichern:

* `data.country` = komplette IRI
* `data.country_code` = letztes Pfadsegment (`CHE`)

---

## 4) Import-Strategie (2-Pass, streaming)

### Warum 2 Passes?

* Kein großes In-Memory-Set
* Datenbank entscheidet per Join, was relevant ist

---

### Pass 1 – OPs registrieren

**Ziel:** Alle Operational Points erfassen

Algorithmus:

* Für jedes Quad:

  * Wenn `predicate == rdf:type`
  * und `object == era:OperationalPoint`

    * `INSERT op_uri ON CONFLICT DO NOTHING`

---

### Pass 2 – Properties anwenden

**Ziel:** Labels & Country nur für bekannte OPs setzen

Algorithmus:

* Für jedes Quad:

  * Wenn `predicate in {rdfs:label, era:inCountry}`

    * Wert in Stage-Map sammeln (`stage[subject][field]`)
* Batchweise:

  * Stage → temporäre Tabelle `op_stage`
  * `UPDATE operational_points JOIN op_stage`

---

## 5) Literal-Behandlung (offline Regeln)

### 5.1 IRI vs Literal

* IRI: `<...>`
* Literal: `"..."`
  optional:

  * Sprach-Tag: `@de`
  * Datentyp: `^^<datatypeIRI>`

**Empfehlung:**
Literal-Parsing über RDF-Library (kein Regex).

---

### 5.2 Sprach-Tags

* Für MVP: nur lexikalischen Wert speichern
* Sprache optional separat mappen (`labels[lang]`)

---

## 6) Postgres Zielschema (minimal)

```sql
create table if not exists operational_points (
  id bigserial primary key,
  op_uri text unique not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_operational_points_data_gin
  on operational_points using gin (data jsonb_path_ops);
```

**Beispiel `data`:**

```json
{
  "label": "Basel SBB",
  "country": "http://publications.europa.eu/resource/authority/country/CHE",
  "country_code": "CHE"
}
```

---

## 7) Named Graph (4. Element im Quad)

* Der `graph`-Teil wird für MVP **ignoriert**
* Alle Quads gleich behandeln

---

## 8) Logging & Smoke-Tests

### 8.1 Logging

* Anzahl gelesener Quads
* Anzahl erkannter OPs (Pass 1)
* Anzahl aktualisierter OPs (Pass 2)

---

### 8.2 SQL Smoke-Test

```sql
select count(*) from operational_points;

select
  op_uri,
  data->>'label'
from operational_points
where data ? 'label'
limit 20;
```

---

## 9) Implementationshinweise (offline)

* Parsing: **N-Quads streaming**
* Input: `lzma.open(path, "rb")`
* Keine Ontologie-Downloads
* Keine SPARQL-Endpunkte
* Exakte IRI-Strings aus Abschnitt 2 verwenden

---

## 10) Zusammenfassung

* **Eine Datei** (`.nq.xz`)
* **Streaming-Import**
* **2 Passes**
* **Offline**
* **JSONB-freundlich & erweiterbar**

> Diese Datei ist bewusst **vollständig autark**.
> **Einmal kopieren – fertig.**

```

---

Wenn du willst, mache ich dir als Nächstes:
- eine **AGENTS.md speziell für Codex**, die genau sagt *„lies diese Datei und generiere Code“*  
- oder eine **ultraknappe Version** (nur Regeln, keine Erklärungen)  
- oder direkt den **finalen Python-Importer**, 1:1 passend zu dieser Spezifikation.
```


