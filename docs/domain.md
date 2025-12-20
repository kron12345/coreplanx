# CorePlanX – Domain Glossary

Dieses Dokument definiert die fachlichen Begriffe von CorePlanX.

---

## Fahrplanjahr
Oberster zeitlicher Rahmen der Planung.

---

## Simulation
Isolierter Planungsraum innerhalb eines Fahrplanjahres.

Typen:
- produktiv
- Sandbox

---

## Fahrplanmanager
Quelle der Zugläufe.

Produktiv:
- Wahrheit gegenüber Infrastruktur
- nicht ersetzbar
- revisionierbar

Simulation:
- frei veränderbar

---

## Zuglauf (TrainRun)
Durchgehender Zug im Fahrplan.

---

## Zugleistung (TrainServicePart)
Planungsrelevanter Teil eines Zuglaufs.

- zerlegbar
- verbindbar
- referenziert den Ursprungslauf

---

## Basisplanung
Stabile, simulationsabhängige Planung.

- strukturiert in Kalenderbereiche
- Grundlage für die Betriebsplanung

---

## Betriebsplanung
Operativer Alltag.

- Snapshot der Basis
- vollständig änderbar
- leistungsabhängige Begründungspflicht

---

## Promote / Publish
Erklärt die Basisplanung einer Simulation zur neuen produktiven Basis.

- Fahrplan bleibt unverändert
- alte Basis wird versioniert

---
