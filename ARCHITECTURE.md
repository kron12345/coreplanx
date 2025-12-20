# CorePlanX – Architecture Overview

Dieses Dokument beschreibt die Ziel-Architektur von CorePlanX.
Es ist verbindlich für Implementierung, UI, Automatisierung und Codex.

---

## 1. Ziel des Systems

CorePlanX ist eine modulare Planungsplattform für zeit- und ressourcenbasierte Planung
im Bahn- und Betriebsumfeld.

Ziele:
- stabile, vorausschauende Planung
- klare Trennung von Planung und Betrieb
- Simulationen ohne Produktionsrisiko
- nachvollziehbare, erklärbare Planung

---

## 2. Grundprinzipien

- Trennung von **Fahrplan**, **Basisplanung** und **Betriebsplanung**
- Simulationen als isolierte Planungsräume
- Produktive Daten sind geschützt und versioniert
- Planung ist erklärbar, nicht Blackbox

---

## 3. Fahrplanjahr

Ein Fahrplanjahr ist der oberste fachliche Rahmen.

Es enthält:
- Fahrplanmanager (produktive Wahrheit)
- Simulationen
- Basisplanung
- genau eine Betriebsplanung

---

## 4. Simulationen (Planungsräume)

### 4.1 Definition
Eine Simulation ist ein isolierter Planungsraum innerhalb eines Fahrplanjahres.

Sie enthält:
- Fahrplandaten (Züge/Zugläufe)
- Basisplanung (Dienste, Tätigkeiten)

---

### 4.2 Produktiv vs. Sandbox

- Pro Fahrplanjahr existiert **genau eine produktive Simulation**
- Sandbox-Simulationen dienen ausschließlich dem Testen

**Publish/Promote:**
- betrifft ausschließlich die Basisplanung
- alte produktive Basis wird archiviert/versioniert
- der produktive Fahrplanmanager bleibt unverändert

---

## 5. Fahrplanmanager

### 5.1 Produktiver Fahrplanmanager (Truth Source)

- repräsentiert die Wahrheit gegenüber der Infrastruktur
- ist **nicht ersetzbar**
- Änderungen erfolgen ausschließlich als **Revision**
- Quellen:
  - Auftragsmanagement
  - externe Schnittstellen

---

### 5.2 Fahrplanmanager in Simulationen

- simulationsabhängig
- frei veränderbar
- keine Rückwirkung auf Produktion

---

## 6. Zuglauf und Zugleistung

### 6.1 Zuglauf (TrainRun)
- durchgehender Zug im Fahrplan
- stammt aus dem Fahrplanmanager
- nicht direkt planungsfähig

### 6.2 Zugleistung (TrainServicePart)
- Teil eines Zuglaufs
- planungsrelevant
- entsteht durch Zerlegung

Eigenschaften:
- manuelle und automatische Zerlegung
- jederzeit änderbar
- verbindbar über Zugläufe hinweg (Umlauf)

---

## 7. Basisplanung

- simulationsabhängig
- stabile, vorausschauende Planung
- strukturiert in **nicht überlappende Kalenderbereiche**
  (z. B. Sommer/Winter/Ferien/Sonder)

- zeitlich fein modellierbar (bis Tag/Minute)

---

## 8. Betriebsplanung

- existiert genau einmal pro Fahrplanjahr
- arbeitet ausschließlich auf produktiver Basis
- Übergabe erfolgt als **Snapshot**
- betriebliche Dienste sind unabhängig

Betrieb darf:
- Zeiten, Orte, Reihenfolgen ändern
- Ressourcen wechseln

Begründungspflicht:
- **leistungsabhängig**
- nur für definierte Leistungstypen verpflichtend

---

## 9. Regeln

- Arbeitszeit- und Pausenregeln gelten in Basis und Betrieb
- Orts- und Kapazitätskonflikte werden in Basis und Betrieb verhindert
- Regeln liefern erklärbare Ergebnisse (Why / Why not)

---

## 10. Verbindliche Policies

- Kein Replace des produktiven Fahrplanmanagers
- Keine Betriebsplanung auf Simulationen
- Promote wirkt nur auf Basisplanung
- Keine Logik-Duplikation zwischen UI und Backend

---
