# Einstellungen · Regeln

Diese Seite beschreibt die Planungsregeln (YAML) und dient als Referenz fuer den CorePlanX Assistant.

## Wo finde ich das?

Navigation:

- **Einstellungen → Regeln**

## Ueberblick

Planungsregeln werden als **YAML** gepflegt und im Backend geparst (JSONB).
Die Regeln sind variantenbezogen (Fahrplanjahr/Variante) und werden im Planungsprozess ausgewertet.
Defaults werden aus `backend/rules/duty/*.yaml` geladen (Stage `base`).

## Regeln

### Feldlexikon

| Feld | Typ | Zweck | Hinweise |
| --- | --- | --- | --- |
| `id` | string | Eindeutiger Schluessel | Pflichtfeld |
| `kind` | string | `generator` oder `constraint` | steuert Auswertung |
| `executor` | string | Backend-Handler | ohne passenden Executor keine Wirkung |
| `enabled` | boolean | Regel aktiv/inaktiv | `false` deaktiviert |
| `params` | object | Regelparameter | regelabhaengig |

### Default-Regeln (Duty & AZG)

Im Standard werden folgende Regeln geladen. Zeiten sind in Minuten, `startHour/endHour` in 24h.

#### duty.generator (generator, duty/autopilot)

Erzeugt Dienste/Schichten automatisch.

Parameter (Defaults):

- `serviceStartTypeId`: `service-start`
- `serviceEndTypeId`: `service-end`
- `breakTypeIds`: `[break]`
- `shortBreakTypeId`: `short-break`
- `commuteTypeId`: `commute`
- `conflictAttributeKey`: `service_conflict_level`
- `conflictCodesAttributeKey`: `service_conflict_codes`
- `maxConflictLevel`: `2`

#### duty.max_work_minutes (constraint, duty/max-work-minutes)

Maximale Arbeitsminuten pro Dienst.

- Parameter: `maxMinutes` (Default 600 = 10h)

#### duty.max_continuous_work_minutes (constraint, duty/max-continuous-work-minutes)

Maximale zusammenhaengende Arbeitszeit ohne ausreichende Pause.

- Parameter: `maxMinutes` (Default 300 = 5h)

#### duty.min_break_minutes (constraint, duty/min-break-minutes)

Mindestdauer einer Pause.

- Parameter: `minMinutes` (Default 30)

#### duty.min_short_break_minutes (constraint, duty/min-short-break-minutes)

Mindestdauer einer Kurzpause.

- Parameter: `minMinutes` (Default 20)

#### duty.max_duty_span_minutes (constraint, duty/max-duty-span-minutes)

Maximale Dienstspanne von Start bis Ende.

- Parameter: `maxMinutes` (Default 780 = 13h, AZG Art. 6 Abs. 1)

#### duty.one_per_day (constraint, duty/one-per-day)

Erlaubt pro Tag nur einen Dienst.

- Parameter: `stageIds` (Default `[base]`)

#### azg.work_avg_7d (constraint, azg/work-avg-7d)

Durchschnittliche Arbeitszeit in 7 Arbeitstagen.

- Parameter: `windowWorkdays` (7), `maxAverageMinutes` (540 = 9h, AZG Art. 4 Abs. 3)

#### azg.work_avg_365d (constraint, azg/work-avg-365d)

Durchschnittliche Arbeitszeit im Jahresfenster.

- Parameter: `windowDays` (365), `maxAverageMinutes` (420 = 7h, AZG Art. 4 Abs. 1)

#### azg.duty_span_avg_28d (constraint, azg/duty-span-avg-28d)

Durchschnittliche Dienstspanne in 28 Tagen.

- Parameter: `windowDays` (28), `maxAverageMinutes` (720 = 12h, AZG Art. 6 Abs. 1)

#### azg.rest_min (constraint, azg/rest-min)

Mindest-Ruhezeit zwischen Diensten.

- Parameter: `minMinutes` (660 = 11h, AZG Art. 8 Abs. 1)

#### azg.rest_avg_28d (constraint, azg/rest-avg-28d)

Durchschnittliche Ruhezeit in 28 Tagen.

- Parameter: `windowDays` (28), `minAverageMinutes` (720 = 12h, AZG Art. 8 Abs. 1)

#### azg.break_max_count (constraint, azg/break-max-count)

Maximale Anzahl Pausen pro Dienst.

- Parameter: `maxCount` (3, AZG Art. 7 Abs. 2)

#### azg.break_forbidden_night (constraint, azg/break-forbidden-night)

Verbotene Pausenfenster in der Nacht.

- Parameter: `startHour` (23), `endHour` (5)

#### azg.break_standard_minutes (constraint, azg/break-standard-minutes)

Standardpause (Mindestdauer) pro Dienstschicht.

- Parameter: `minMinutes` (60, AZG Art. 7 Abs. 1 / Art. 11 Abs. 1-2)

#### azg.break_midpoint (constraint, azg/break-midpoint)

Pause soll ungefaehr zur Haelfte der Arbeitszeit liegen.

- Parameter: `toleranceMinutes` (60, AZG Art. 7 Abs. 1)
- Gilt fuer Dienste ueber `azg.break_interruption.maxDutyMinutes` (Default 9h).

#### azg.break_interruption (constraint, azg/break-interruption)

Arbeitsunterbrechung (Kurzpause) statt Pause, wenn Arbeitszeit <= `maxWorkMinutes` und Dienstschicht <= `maxDutyMinutes`.

- Parameter: `minMinutes` (20, AZG Art. 7 Abs. 4), `maxWorkMinutes` (360 = 6h), `maxDutyMinutes` (540 = 9h)

#### azg.night_max_streak (constraint, azg/night-max-streak)

Maximale Anzahl aufeinanderfolgender Nachtdienste.

- Parameter: `maxConsecutive` (7, AZG Art. 9 Abs. 3)

#### azg.night_max_28d (constraint, azg/night-max-28d)

Maximale Anzahl Nachtdienste innerhalb von 28 Tagen.

- Parameter: `windowDays` (28), `maxCount` (14, AZG Art. 9 Abs. 3)

#### azg.rest_days_year (constraint, azg/rest-days-year)

Mindestanzahl Ruhetage pro Jahr.

- Parameter: `minRestDays` (62), `minSundayRestDays` (20), `additionalSundayLikeHolidays` ([])

#### azg.exceed_buffer_minutes (constraint, azg/exceed-buffer-minutes)

Toleranzpuffer fuer Grenzwert-Ueberschreitungen.

- Parameter: `bufferMinutes` (10, AZG Art. 5 Abs. 3 / Art. 6 Abs. 3)

## Regel-Cookbook (Praxisrezepte)

### Arbeitszeitlimit anheben

```yaml
id: duty.max_work_minutes
kind: constraint
executor: duty/max-work-minutes
enabled: true
params:
  maxMinutes: 540
```

### Nacht-Pausenfenster anpassen

```yaml
id: azg.break_forbidden_night
kind: constraint
executor: azg/break-forbidden-night
enabled: true
params:
  startHour: 22
  endHour: 6
```

### Autopilot strenger machen (Konflikte)

```yaml
id: duty.generator
kind: generator
executor: duty/autopilot
enabled: true
params:
  maxConflictLevel: 1
```

### Weitere Feiertage als Sonntag behandeln

```yaml
id: azg.rest_days_year
kind: constraint
executor: azg/rest-days-year
enabled: true
params:
  minRestDays: 62
  minSundayRestDays: 20
  additionalSundayLikeHolidays:
    - 2026-01-01
    - 2026-12-25
```

### Regel temporaer deaktivieren

```yaml
id: duty.min_short_break_minutes
kind: constraint
executor: duty/min-short-break-minutes
enabled: false
params:
  minMinutes: 20
```

## Fehlerbilder & Loesungen

- **Regel wird nicht gespeichert**
  - YAML pruefen (Syntaxfehler) und `id` muss gesetzt sein.
- **Regel wirkt nicht**
  - `enabled` ist false oder `executor` existiert nicht.
- **Regelliste ist leer**
  - Variante/Stufe pruefen (Defaults werden nur fuer `base` geladen).

## Kontext-FAQ

- **Generator vs. Constraint?**
  - Generatoren erzeugen Vorschlaege (z. B. Autopilot), Constraints validieren.
- **Woher kommen die Defaults?**
  - Aus `backend/rules/duty/*.yaml`.
- **Kann ich eigene Regeln hinzufügen?**
  - Ja, solange Backend-Executors vorhanden sind.

## Abhaengigkeiten & Fluss

- YAML → Backend-Parser → DB (JSONB) → Regel-Engine
- `duty.generator` → Autopilot-Konfiguration → Dienstvorschlaege

## Wo wirken die Einstellungen?

- Regeln werden im **Backend** ausgewertet und beeinflussen Generierung/Validierung der Planung.
- Aenderungen gelten fuer die aktuell ausgewaehlte Variante.
