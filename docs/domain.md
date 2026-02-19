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

## Fahrplan-Bestellfall (Ordering Case)
Operativer Bestellvorgang im Fahrplanmanagement.

- gehört genau zu einem Prozessprofil (z. B. Jahresbestellung, Gelegenheitsverkehr)
- hat einen Zustand mit nachvollziehbarer Historie
- kann fahrplanjahrübergreifend mehrere operative Kontexte enthalten

---

## Prozessprofil (TTT)
Konfiguration für den Bestellablauf.

- definiert erlaubte Zustände
- definiert Zustandsübergänge
- definiert Pflichtattribute vor dem Senden

---

## Event-Tuple (TTT)
Kanonischer Schlüssel für Übergänge.

Bestandteile:
- Actor
- MessageType
- MessageStatus
- TypeOfRequest (TOR)
- TypeOfInformation (TOI)

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
