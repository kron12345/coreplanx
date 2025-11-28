# Auftragsmanagement – Produktspezifikation

## 1. Zielsetzung und Kontext

Das Auftragsmanagement bildet den Einstiegspunkt fuer Disponent:innen, die TTR/TTT-Auftraege durch den kompletten Lebenszyklus fuhren muessen. Die Angular-18-Oberflaeche dient als Referenz fuer ein kuenftiges NestJS-Backend und liefert Mock-Daten, KPIs, Filter, Bearbeitungs- und Automations-Workflows, die ohne Server ausprobiert werden koennen. Diese Spezifikation dokumentiert die funktionalen und nichtfunktionalen Erwartungen an die Module unter `src/app/features/orders` sowie die zugehoerigen Core-Services.

## 2. Produktziele und Geltungsbereich

- Transparenz ueber alle Auftraege, Positionen und Phasen vom Capacity Supply bis zur operativen Auslieferung.
- Schnelles Auffinden und Bearbeiten relevanter Positionen (Filter, Suche, Presets, Insights).
- Direkte Verknuepfung von Auftragspositionen mit Geschaeften, Statuswechseln und Automationsregeln.
- Automatisches Anlegen/Erweitern von Geschaeften je TTR-Phase inklusive konfigurierbarer Templates und Bucketing.
- Echtzeit-Synchronisation zwischen Tabs/Fenstern und spaeter zwischen mehreren Clients via SSE.
- Mockbare Datenquelle fuer Tests, Demos und Edge-Case-Analyse.

Nicht Bestandteil dieser Spezifikation: Authentifizierung, Persistenz in echten Datenbanken, sowie detaillierte Planungs- und Ressourcenfunktionen ausserhalb des Order-Bereichs.

## 3. Personas und Kernszenarien

| Persona | Ziel | Wichtige Szenarien |
| --- | --- | --- |
| Disponent:in Rolling Planning | Tagesscharfe Steuerung | Filter nach Phase, Bulk-Submission, Abweichungen priorisieren, Geschaefte verknuepfen |
| Teamlead Vertrieb | Pipeline-Monitoring | KPIs lesen, Presets fuer Regionen, Insights teilen |
| Automations-Owner | Templates & Regeln pflegen | Phase-Definitionen konfigurieren, Automation-Runs pruefen, Bucket-Logik anpassen |
| Datenintegrator:in | Backend-Anbindung validieren | Event-Stream beobachten, Mock-IDs nutzen, API-Kontrakte pruefen |

## 4. Aufbau der Auftragsuebersicht

### 4.1 Layout & Raster

- Die Landing-View (`OrderListComponent`) nutzt ein dreispaltiges Raster fuer grosse Displays (>1440px): links Filter/Insights, mittig Hero-Metriken + Order-Liste, rechts das optionale Template-Panel. Darunterliegende Breakpoints klappen den rechten Bereich unter die Liste und verschieben Filter-Controls in eine Sticky-Bar.
- Hero-Metriken und Insights sind in Cards gegliedert, die auf Desktop nebeneinander (Wrap mit Flex-Gap) stehen und auf Tablets/Mobile in einer Spalte erscheinen.
- Order Cards nutzen ein durchgehendes Panel-Layout mit collapsible Body; pro Card existieren Header (Titel), Meta-Bar (Kunde, Tags, Fahrplanjahr), KPI-Slices (Health, Summaries) und Item-Liste.

### 4.2 Header-Sektion

- Oberer Bereich enthaelt Page-Title, Aktionen (`Neuer Auftrag`, `Template-Empfehlungen`, `Filter speichern`) sowie einen Breadcrumb/Hint fuer aktive Stage (z. B. `Planung · Auftraege`). Buttons nutzen Angular Material Icons plus Tooltips.
- Direkt darunter stehen Hero-Metriken: Jede Karte zeigt Icon, Label, Wert, Hint und optional eine Aktion (`focusTtrPhase`, `focusUpcoming`). Bei schmalen Screens werden Karten horizontal scrollbar (Snap) dargestellt.

### 4.3 Filter- und Suchleiste

- Persistente Filterleiste kombiniert:
  - Suchfeld mit Autocomplete (Tag/Responsible-Vorschlaege) und Token-Unterstuetzung (`tag:`, `resp:`). Eingaben triggern Signals mit 200-ms-Debounce.
  - Tag- und Responsible-Pills, TTR-Phase-Selector (Chips), Timeline-Referenz (Segmented Button) und Fahrplanbereich (Datepicker mit Range-Badge).
  - Preset-Dropdown mit Save/Update/Delete sowie Reset-Buttons fuer einzelne Filter (Tag, Phase, FP-Range, Timeline).
- Leiste ist sticky unterhalb des Header-Bereichs, damit Filter bei Scroll im Viewport bleiben. Auf Mobile wird sie zu einem Accordion mit zusammenklappbaren Gruppen.

### 4.4 Insights-Spalte

- Unterhalb der Filterleiste befinden sich Insight-Karten:
  - **Tag Insights:** Liste der Top-3 Tags inkl. Tonalitaet (Region/Phase/Risk/Priority) und CTA, der Filter setzt (`applyTagInsight`).
  - **Responsible Insights:** Analog fuer Verantwortliche mit direktem `resp:`-Token.
  - **Collaboration Context:** Textkarte mit Icon und Hinweis, wann gemeinsame Arbeit noetig ist (z. B. „Short-Term aufholen“).
- Nutzende koennen die gesamte Insight-Sektion einklappen; Status liegt im Storage (`orders.insightsCollapsed.v1`).

### 4.5 Order-Liste & Cards

- Liste rendert `orders()` als `@for`-Schleife (Standalone `OrderCardComponent`). Zwischen Cards liegen 16px Gap, infinite Scroll ist nicht notwendig (Datenmenge begrenzt durch Filter).
- Jede Card enthaelt:
  1. **Header:** Titel, Order-ID, Tag-Badges (#), Kunde (Name + Icon), optional Kommentar-Hinweis.
  2. **Health Snapshot:** Kreisdiagramm-Badge mit Tonalitaet (`ok`, `warn`, `critical`), Abweichungs-/Upcoming-Counts, Proportion-Balken.
  3. **Summary-Chips:** Business-Status, Timetable-Phasen, TTR-Phasen (Farbchips), Varianten, Fahrplanjahre; alle Chips reagieren auf Klick (Filter toggeln).
  4. **Actions:** Buttons fuer Position-Dialog (`openPositionDialog`), Business-Linking, Status-Update, Selection-Mode, Submission.
  5. **Item-Liste:** Standardmaessig eingeklappt, zeigt in Expanded-Modus jede Position mit Typ-Icon, Zeitfenster, Responsible, Tags, Deviation-Hinweis, Business-Badges.
- Highlighting (`highlightItemId`) markiert Items gelb und scrollt sie in View. Hover-States sind farblich dezent, Selection-Checkboxen erscheinen nur im Selection Mode.

#### 4.5.1 Aufbau einer Order Card

- **Container & Interaktion:** `mat-card` mit `appearance="outlined"` dient als klickbarer Accordion-Trigger. `toggleExpanded()` oeffnet/schliesst den Body; der Header ist fokussierbar (`tabindex="0"`), damit Tastatur-User expandieren koennen.
- **Header-Zeile:**
  - ID-Pill (`assignment`-Icon) + Klartextname.
  - Meta-Zeile zeigt optional Kunde (`business`), Fahrplanjahr (`event`), freie Tags (Material-Chips), sowie Fahrplanjahr-Summen der Positionen.
  - Customer-Panel (falls `CustomerService` Details liefert) listet Kundennummer, Projektnummer, Ansprechpartner, Regionen und Flags wie SLA oder Premium-Stufe.
- **Health-Sektion:** `orderHealth()` liefert Snapshot mit:
  - Signal-Badge (Icon: `task_alt`, `warning`, `priority_high`) + Label (`Planmäßig`, `Beobachten`, `Kritisch`).
  - Mini-Stats (Demnächst, Abweichungen, Positionen) mit Tooltips.
  - Timeline-Bar mit Segmenten fuer `aktiv`, `bevorstehend`, `offen` inkl. Prozenten sowie Legende.
- **Summaries:** vier Gruppen im unteren Header-Bereich:
  - Business-Status (Map auf `BusinessStatus` -> Label, CSS-Klasse). Klick toggelt `businessStatus`-Filter.
  - Timetable-Phasen (Chips; Clear-Icon ueber `clearPhaseFilter`).
  - TTR-Phasen (Chips mit Tooltip `window + hint + reference-label`; nur filterbare Phasen aktivierbar).
  - Varianten/Fahrplanjahre (Chip-Sets mit Count). Varianten stammen aus `originalTimetable.variants`.
- **Action-Spalte (rechte Seite):**
  - Primäre Button-Gruppe: Selection Mode Toggle (`checklist`), Positions-Dialog (`add`), Options (`more_vert` mit zukuenftigen Aktionen).
  - Sekundaere Aktionen: `Geschäft verknüpfen`, `Status aktualisieren`.
- **Expanded-Body:**
  - `selectionMode` blendet eine Kontextleiste ein (Auswahl-Count, Buttons `Bestellen`, `Abbrechen`).
  - `app-order-item-list` traegt `effectiveItems()`, Bulk-Selection-Props und Events.
  - Optionaler Kommentarblock (Icon `info`, Freitext).

#### 4.5.2 Darstellung einzelner Auftragspositionen

- **Grundstruktur:** Jedes Item ist ein flexibles Panel mit linkem Content-Bereich und rechter Aktionsleiste. `@for (orderedItems)` sortiert Positionen nach Startzeit (inkl. Versionshierarchie) und weist CSS-Klassen fuer Versionstiefe (`versionDepthClass`) sowie Highlights zu.
- **Kopfbereich:**
  - Name + optionale Versions-Chips (`Version X`, `Abgeleitet von …`), differenziert zwischen Parent/Child.
  - Typ (Leistung/Fahrplan), Zeitfenster (`formatScheduleTime`), Verantwortliche, Timetable-Phase-Chip (Statusfarbe), TTR-Phase-Chip (Tooltip mit Fenster/Hinweis).
- **Zeit & Geltung:**
  - Validity-Bereich (`calendar_month` Icon) listet Datumsspannen aus `OrderItem.validity`.
  - Route-Zeile zeigt `fromLocation → toLocation` plus ServiceType-Tag.
- **Tags & Referenzen:**
  - Item-Tags als Mat-Chips (`sell` Icon).
  - Buttons (Mat-stroked) fuer verknuepfte Ressourcen:
    - Train-Plan (`train`, clickable Link).
    - Traffic Period (`calendar_today`).
    - Template (`schema`).
    - Generated Timetable (`edit_calendar` → Fahrplanmanager).
- **Original-Fahrplan:** Bei `originalTimetable` werden Zugnummer, Kalenderbereich, Route, Varianten (mit Tooltips) und Modifikationen (Typ, Datum, Notizen) angezeigt.
- **Business-Verknuepfungen:** `businessesForItem` liefert Karten mit:
  - Titel, Status-Chip (`status-neu` etc.), Beschreibung.
  - Meta (Erstell-/Fälligkeitsdatum, Assignment Icon/Label).
  - Dokumentliste (Stroked Buttons mit File-Icon). Ganze Karte ist fokussier-/klickbar und oeffnet das Geschäft (`onBusinessCardClick`/`Keydown`).
- **Aktionsleiste rechts:**
  - Edit-Button (`edit`) oeffnet `OrderItemEditDialog`.
  - Submit-Button (`send`) ruft `submitRequested` (einzelne Bestellung).
  - Abweichung (`it.deviation`) erscheint als Badge.
- **Bulk-Selection:** Wenn `selectionMode` aktiv ist, erscheint links eine Checkbox; Items melden Änderungen ueber `(toggleSelection)` an den Parent. Hover, Focus und Auswahl werden via CSS differenziert.
- **Leere Stati:** Falls `items` leer sind, zeigt die Komponente ein `inbox`-Placeholder inkl. Text.

### 4.6 Rechte Spalte / Template Panel

- Collapsible Panel zeigt Empfehlungen aus `BusinessTemplateService`. Trigger befindet sich im Header (Button „Empfehlungen“). Panel enthaelt Karten mit Template-Titel, Tags, Einsatzhinweis, CTA zur Template-Hub.
- Auf kleineren Screens ueberlagert das Panel die Order-Liste (Modal Sheet) und kann via Close-Button oder Klick ausserhalb geschlossen werden.

### 4.7 Interaktionen & Feedback

- Alle Mutationen (Submit, Link, Statuswechsel) quittieren via `MatSnackBar` mit kontextualisiertem Text.
- Dialoge oeffnen in `MatDialog` mit `maxWidth 95vw`, adaptiven Breakpoints und Scrollable Content.
- View-Transitions (Flag `isViewTransitioning`) aktivieren CSS-Animationen beim Wechseln grosser Filter, damit Reflow als sanftes Fade wahrgenommen wird.
- Tastaturfokus: Buttons, Chips und Checkboxen erhalten `mat-focus-indicator`; Selection Mode kann nach dem Aktivieren mit ESC beendet werden.

### 4.8 Geschäftsübersicht & Funktionen

- **Hero & Aktionen**
  - `BusinessListComponent` stellt die Geschäfts-Pipeline dar. Ein Hero-Bereich (Eyebrow „Pipeline · X aktiv“) zeigt `overviewMetrics` (total, active, overdue, dueSoon) und `metricTrends`. Vier KPI-Karten (Aktiv, Abgeschlossen, Überfällig, Diese Woche fällig) besitzen Trendanzeige, CTA-Button (`applyMetricFilter`) und Icon.
  - Aktionsgruppe: `Befehle` (öffnet `BusinessCommandPaletteDialog`, Shortcut ⌘/Ctrl + K), `Filter zurücksetzen`, `Neues Geschäft` (`BusinessCreateDialog`, Shortcut ⇧ + N). Ein Hinweistext listet die Shortcuts auf.

- **Team-Insights**
  - Kollabierbare Insight-Sektion (persistiert in `business.insightsCollapsed.v1`) enthält Karten für Kontext (`insightContext`), beliebte Tags (`topTagInsights`), Top-Zuständigkeiten (`topAssignments`), Statusverteilung (`statusBreakdown`) und Fälligkeiten (`dueSoonHighlights`).
  - Buttons auf den Karten setzen sofort entsprechende Filter (`applyTagInsight`, `applyAssignmentInsight`, `applyStatusInsight`, `focusDueSoon`). Fälligkeiten zeigen due-state-spezifische Styles (`dueDateState`).

- **Filter-Shelf & Suche**
  - Suchfeld mit Autocomplete (`searchSuggestions`) akzeptiert Freitext sowie Tokens `tag:`, `assign:`, `status:`; Help-Menü erklärt Syntax. Eingaben sind auf 80 Zeichen begrenzt und werden 200 ms debounced.
  - Schnellauswahl der Fälligkeit (`dueDatePresetOptions`), Status-Dropdown (`statusOptions`), Assignment-Filter, Sortiermenü (`BusinessSort`), sowie Filter-Presets (Speichern, Umbenennen, Entfernen). Filter/SORT persistieren in `business.filters.v1` bzw. `business.sort.v1`.
  - Tag-Chips zeigen Tonalität (`tagTone`) und Anzahl (`tagCount`); Buttons toggeln Filterzustände.

- **Vorlagen & Erstellung**
  - `<app-business-create-from-template>` bietet Direktzugriff auf Business Templates inklusive empfohlener Assignments/Due-Rules.
  - Command Palette enthält `BusinessCommandDefinition` (z. B. „Status ändern“, „Tag setzen“) zur Tastatursteuerung.

- **Hauptliste & Bulk-Modus**
  - Kein Treffer führt zu einem Outlined-Card-Leerzustand mit CTA.
  - Bulk-Toolbar erscheint, wenn mindestens ein Checkbox-Häkchen (`toggleBulkSelection`) aktiv ist: Sammelaktionen für Status („In Arbeit“, „Pausiert“, „Erledigt“), „Alle sichtbaren“ selektieren, Auswahl löschen.
  - `isViewTransitioning()` blendet Skeleton Cards ein, bis neue Daten geladen sind.

- **Business Cards**
  - Jede Card zeigt Checkbox, Titel, Health-Badge (`healthBadge`), ID-Pill, Timeline (`businessTimeline` mit States `past/current/future`) und Highlight-Pills (`businessHighlights`) – Klicks auf Pills lösen Filter aus (`applyHighlightFilter`).
  - Tag-Reihe zeigt farbcodierte Chips. Tabs:
    1. **Details:** Beschreibung, Status-Select (`onStatusChange`), Metric-Pills (`businessMetrics`).
    2. **Positionen:** Übersicht verknüpfter Order Items, Buttons „Positionen zuordnen“ (`openOrderItemPicker`) und „Auftragsübersicht“. Grid listet jedes Item mit Service/Zeitraum und Aktionen „Öffnen“ / „Verknüpfung lösen“.
    3. **Dokumente:** Downloads (`Business.documents`) oder Placeholder.

- **Detail-Pane**
  - Rechts neben dem Grid erscheint bei `selectedBusiness()` ein Pane mit Progress-Ring (`dueProgress`), Resttagen, Fälligkeitsdatum, Assignment und Status.
  - Tag-Management (Chips mit Remove, Input + Vorschläge), KPI-Karten, Quick Actions (Positionen pflegen, Order-View öffnen, Löschen), Activity Feed (`businessActivityFeed`) und Liste verknüpfter Positionen inklusive Direktlinks (`goToOrderItem`).

- **Order-Integration**
  - `OrderItemPickerDialog` erlaubt Mehrfachauswahl + Filterung, synchronisiert Links via `BusinessService.setLinkedOrderItems`.
  - `openOrderOverview` navigiert zur Order-Liste mit Query `businessId`, wodurch Order Cards automatisch filtern und expandieren.
  - Entfernen von Links (`removeLinkedItem`) aktualisiert sowohl `BusinessService` als auch `OrderService`.

- **Persistenz & Datenbasis**
  - Daten stammen aus `BusinessService` (Mock `MOCK_BUSINESSES`). Filter/Sort/Insights nutzen Browser Storage.
  - `BusinessCreateDialog` (Freiform) und `BusinessCreateFromTemplateComponent` (Template-gesteuert) erzeugen neue Einträge; `businessService.deleteBusiness` entfernt sie und löst Unlinks aus.

### 4.9 Beziehung Geschäfte ↔ Auftragspositionen

- **Datenmodell**
  - Jede `OrderItem` trägt `linkedBusinessIds?: string[]`. Die Reihenfolge entspricht dem Zeitpunkt der Verknüpfung; UI-Komponenten (Order Cards, Item-Liste) lesen darüber Status, Beschreibung, Dokumente.
  - Auf Business-Seite existiert das Gegenfeld `linkedOrderItemIds?: string[]`. `BusinessService.setLinkedOrderItems` sorgt dafür, dass neue/entfernte IDs beidseitig synchronisiert werden, indem es `OrderService.linkBusinessToItem` bzw. `unlinkBusinessFromItem` aufruft.
  - Beim Anlegen neuer Geschäfte über Templates werden automatisch zusätzliche Tags vergeben (`template:<id>`, `phase:<phaseId>`, Bucket-Tags) und die initialen Order Items als Link gespeichert.

- **Verknüpfungsflows (Order-Perspektive)**
  - `OrderLinkBusinessDialogComponent` lässt Nutzende mehrere Positionen auswählen und mit einem bestehenden Geschäft verknüpfen. Änderungen landen sofort in `OrderService.linkBusinessToItem` und `BusinessService.setLinkedOrderItems`.
  - Der Dialog „Auftragsposition hinzufügen“ (siehe 6.5) bietet im Business-Bereich drei Modi:
    1. *Ohne Geschäft* – keine Aktion.
    2. *Bestehend* – Nutzer:innen wählen eine Business-ID; nach der Item-Erstellung ruft `applyBusinessLink` `setLinkedOrderItems` mit der erweiterten Liste auf.
    3. *Vorlage* – `BusinessTemplateService.instantiateTemplate` erstellt ein neues Geschäft (inkl. Tags, Due-Rule, Assignment). Die frisch generierte Business-ID wird mit den neuen Items verknüpft.
  - Order-Items zeigen verknüpfte Geschäfte direkt innerhalb der Card (`businessesForItem`) samt Status, Beschreibung, Fälligkeits- und Assignment-Infos; Klick öffnet die Business-Detailansicht.

- **Verknüpfungsflows (Business-Perspektive)**
  - Tab „Positionen“ in jeder Business-Card listet alle verknüpften Order Items mit Meta-Daten (Order-Name, Service, Zeitraum). Buttons bieten `Öffnen` (sprung zur Order Card) und `link_off` zum Entfernen.
  - `OrderItemPickerDialog` (aus der Business-Card oder Detail-Pane erreichbar) erlaubt Multi-Selection von Order Items und schreibt das Ergebnis via `setLinkedOrderItems`. Neue Zuordnungen erscheinen nach Bestätigung sofort in beiden Views.
  - Im Detail-Pane werden verknüpfte Positionen nochmals als Liste angezeigt; `goToOrderItem` navigiert zur Order-Ansicht mit `highlightItem`.

- **Synchronisationslogik**
  - `BusinessService.createBusiness` und `deleteBusiness` sorgen für automatische Link-/Unlink-Aufrufe, damit Order Items konsistente `linkedBusinessIds` besitzen.
  - `OrderService.linkBusinessToItem` aktualisiert das jeweilige Order Item (Signal `orders`), `unlinkBusinessFromItem` entfernt IDs und aktualisiert die Karte.
  - Beide Services verhindern Duplikate (per `Set`) und räumen entfernte IDs auf, sodass keine verwaisten Referenzen verbleiben – wichtig für Order Cards, die Business-Badges berechnen, und für Automationen, die auf Tag/Status der Geschäftsseite zugreifen.

- **UI-Auswirkungen**
  - Order Cards nutzen Business-Links für Summaries (Business-Status-Badges, Bulk-Filter). Entfernt man einen Link, verschwinden die Chips sofort.
  - Business Cards spiegeln den Fortschritt der verknüpften Positionen in Metric-Pills („Verknüpfte Positionen“, „Positionen mit Abweichung“) und Aktivitätseinträgen („Position XY verknüpft/gelöst“).
  - Durch die Query-Parameter (`?businessId=` bzw. `highlightItem=`) lassen sich Kontextwechsel orchestrieren: Ein Klick aus der Business-Liste öffnet Order-Liste oder -Card mit passender Vorauswahl und Scroll/Highlight.

### 4.10 Kundenbereich

- **Zweck & Datenbasis**
  - `CustomerListComponent` fungiert als leichtgewichtiges CRM. `CustomerService` liefert Mock-Daten inklusive Kontakten; `OrderService` wird eingebunden, um verknüpfte Aufträge abzuleiten und bei Löschungen (`removeCustomerAssignments`) Referenzen zu entfernen.

- **Hero & Insights**
  - Herozeile („CRM · X aktiv“) zeigt `heroMetrics` (Kunden, Kontakte, Projekte, verknüpfte Aufträge) und bietet eine Aktion „Suche löschen“. Metrik-Karten besitzen CTAs (z. B. Reset der Suche).
  - Insight-Sektion (persistiert via `customers.insightsCollapsed.v1`) enthält:
    - Kontextkarte (`insightContext`) mit Botschaften („Viele Projekte ohne Ansprechpartner“ etc.).
    - Ranglisten für Kontaktrollen (`topContactRoles`), Projektnummern (`topProjects`) und Accounts mit vielen Order-Verknüpfungen (`topAccountsByOrders`).

- **Suche, Filter & Presets**
  - Filter-Shelf besteht primär aus einem Suchfeld (durchsucht Name, Kundennummer, Projektnummer, Adresse, Kontakte). Hilfe-Menü erklärt Scope.
  - Aktive Filter werden als Pill dargestellt; aktuell existiert nur die Volltextsuche, weitere Filter könnten ergänzt werden.
  - Nutzer:innen können Filteransichten speichern (`CustomerFilterPreset`, persistiert in `customers.presets.v1`) inklusive Aktionen duplizieren, umbenennen, löschen. Aktive Presets erhalten visuelle Markierung.
  - Der Suchterm selbst wird in `customers.search.v1` persistiert, sodass das CRM in den zuletzt genutzten Zustand zurückkehrt.

- **Kundenanlage & Kontakte**
  - Formularkarte „Neuen Kunden anlegen“ (mat-card) nutzt Reactive FormGroup mit Feldern:
    - Pflicht: `name`, `customerNumber`.
    - Optional: `projectNumber`, `address`, `notes`.
    - Kontakte: FormArray mit `name`, `role`, `email` (inkl. Validierung), `phone`. Buttons ermöglichen Hinzufügen/Entfernen.
  - Beim Speichern (`submit`) wird ein `CreateCustomerPayload` an `CustomerService.createCustomer` übergeben. Anschließend wird das Formular zurückgesetzt.
  - Löschen (`deleteCustomer`) zeigt Browser-confirmation und ruft `CustomerService.deleteCustomer` sowie `OrderService.removeCustomerAssignments`, damit Orders keine veralteten IDs enthalten.

- **Kundenliste & Auftragsbezug**
  - Grid-Ansicht zeigt Cards mit Name, Kundennummer, optional Projektnummer, Adresse, Notizen sowie Kontaktchips (Icon, Rolle, E-Mail, Telefon).
  - Bereich „Verknüpfte Aufträge“ nutzt `linkedOrders(customer.id)` (Filter über `OrderService.orders`), zeigt Chips `order.id · order.name` oder Hinweis „Keine Aufträge verknüpft“.
  - Empty States informieren über fehlende Kunden oder leere Suchtreffer. Delete-Button auf der Card entfernt den Kunden (inkl. Order-Bereinigung).
  - Kundeninformationen werden in der Order Card (Customer-Pill), im Order Create Dialog (Auswahl + Anzeige von Kontaktinfos) sowie im Business-Kontext (z. B. Notes/Projekte) referenziert.

- **Persistenz & Integration**
  - Kunden- und Kontaktobjekte dienen als Stammdatenquelle für Order Create Dialogs (Dropdown, `selectedCustomer()`), Order Cards (Kundenpanel) und Reporting (z. B. Hero-Metriken im Order-Modul).
  - Änderungen am Kunden (z. B. neue Kontakte) wirken sich sofort auf verknüpfte Order Cards aus, da `CustomerService.customers` ein Signal ist, das überall injiziert werden kann.

### 4.11 Datenfluss Order ↔ Fahrplanmanager

- **Quellen & Ziele**
  - Jede Fahrplan-bezogene Auftragsposition erzeugt bzw. referenziert zwei Kerndaten:
    1. `TrainPlan` (`TrainPlanService`): konkreter Fahrplan mit Stops, Rolling-Stock, Kalender, Responsible, Status, Quelle.
    2. `TrafficPeriod` (`TrafficPeriodService`): Referenzkalender mit Regeln, Varianten und Tags, die Fahrplantage definieren.
  - Beide Daten landen im Archiv (`/archive` → `ArchivePageComponent`) und lassen sich dort unabhängig vom Order-Kontext pflegen.

- **Order → Fahrplanmanager**
  1. **Kalender bestimmen:** Dialog sammelt `calendarDates`/`calendarExclusions`. Falls kein `trafficPeriodId` vorliegt:
     - Service: `createSingleDayPeriod` mit Tags `order:<id>:service:<slug>`.
     - Serie: `createTrafficPeriodForPlanDates`.
     - Manuell: `createManualTrafficPeriod`.
     - RailML: `ensureCalendarsForImportedTrains` gruppiert Züge (`groupId`) und erzeugt Perioden mit Tags `import:<groupId>`.
  2. **TrainPlan erzeugen:** Abhängig vom Modus ruft `OrderService`:
     - `addPlanOrderItems` → `trainPlanService.createPlansFromTemplate`.
     - `addManualPlanOrderItem` → `trainPlanService.createManualPlan`.
     - `addImportedPlanOrderItem` → `trainPlanService.createManualPlan` mit importierten Stops.
  3. **Verknüpfen:** Order Items speichern `linkedTrainPlanId`, `trafficPeriodId`, `linkedTemplateId`. `trainPlanService.linkOrderItem` hält Gegenreferenz aktuell, `TrafficPeriodService` ergänzt `timetable-year:<label>` und `archive-group`-Tags (`buildArchiveGroupTags`).
  4. **Archivierung:** Train Plans/Traffic Periods erscheinen sofort in den Archiv-Tabs (Filter, Suche, Highlight via Query). Tags (z. B. `archive-origin:manual`) ermöglichen Gruppierung/Filterung.

- **Fahrplanmanager → Order**
  - TrainPlan Cards zeigen `linkedOrderLabel`; Klick führt zur Order-Liste (`highlightItem`) oder Order-Dialog.
  - Traffic Period Cards nutzen Tags `order:<id>` und können Orders kontextualisieren. Über `highlightPeriod` lässt sich eine Periode nach Navigation automatisch markieren.
  - Änderungen (z. B. `assignTrafficPeriod`, Plan-Modifikationen) wirken über Signals auf Order/Business-UI. `OrderItemList` zeigt aktualisierte Kalendernamen (`trafficPeriodName`).

- **Cross-Flows & Tools**
  - `PlanAssemblyDialog` und `OrderItemEditDialog` öffnen bei Bedarf den Fahrplanmanager (z. B. „Fahrplan zusammenstellen“), speichern Resultate wieder via TrainPlan-/TrafficPeriod-Services.
  - Buttons in Order Cards (z. B. „Fahrplanmanager“) setzen Query-Parameter (`highlightPlan`). Das Archiv entfernt den Highlight-Query nach kurzer Zeit, damit Links wiederholbar sind.
  - Traffic Period Editor bietet manuelle Pflege; geänderte Zeiträume propagieren in Order Cards (Gültigkeit, Hinweise).

- **Persistenz & Verträge**
  - Derzeit liegen Daten in Mock-Services; spätere Implementierungen nutzen REST-Endpunkte (Plan-Manager). IDs (`linkedTrainPlanId`, `trafficPeriodId`) und Tags (`order:<id>`) dienen als API-Vertrag zwischen Order-Frontend und Fahrplanmanager.
  - Archivdaten (Train Plans, Traffic Periods) werden bei Order-Exporten oder Business Insights verwendet (z. B. „Verknüpfte Positionen“ im Business Pane).

### 4.12 Vorlagenlandschaft

- **Business Templates**
  - Zentraler Service: `BusinessTemplateService`. Templates enthalten Titel, Beschreibung, Instruktionen, Tags, `recommendedAssignment`, `dueRule` (Anchor, Offset, Label), `defaultLeadTimeDays`, Steps und optionale Automation-Hinweise. Persistenz erfolgt in `business.templates.store.v1`.
  - UI-Einstiege:
    - `BusinessCreateFromTemplateComponent` (Geschäftsübersicht) zeigt Kategorien/Tags und ruft `instantiateTemplate`.
    - Templates-Hub (`templates-landing.component`) listet alle Vorlagen, erlaubt Bearbeiten (`business-template-edit-dialog`), Duplizieren, Löschen.
    - Order-bezogene Dialoge (z. B. `OrderPositionDialog` Business-Sektion) nutzen Template-Auswahl, um beim Anlegen neuer Positionen automatisch ein Geschäft zu erstellen.
  - `instantiateTemplate(templateId, context)` erzeugt über `BusinessService.createBusiness` einen realen Eintrag. Tags wie `template:<id>` werden ergänzt; optionale `linkedOrderItemIds` verknüpfen neue Positionen sofort.

- **Phase-Templates & Automationen**
  - `TTR_PHASE_TEMPLATE_DEFINITIONS` (in `ttr-phase-template.config.ts`) definieren pro TTR-Phase (z. B. Rolling Planning) Regeln: Label, Summary, Zeitfenster (Start/End in Minuten/ Tagen/ Wochen, Bucket), `timelineReference`, `autoCreate`, verknüpfte Business-Template sowie Conditions (`AutomationCondition`).
  - Overrides:
    - Fenster (`business.phaseWindows.v1`), Automationsstatus (`business.phaseAutomation.v1`), Bedingungen (`business.phaseConditions.v1`) und Custom-Phasen (`business.customPhases.v1`) lassen sich via Template-Hub anpassen.
    - Jede Phase erhält Tags `phase:<id>` und bucket-spezifische Tags `phase-bucket:<id>:<bucket>`.
  - `TtrBusinessAutomationService` beobachtet `orderService.itemTtrPhaseIndex()`, prüft Zeitfenster/Conditions und erstellt oder erweitert Geschäfte automatisch (Logging über `logAutomationRun`). So entstehen gleichartige Vorgänge (z. B. für Rolling Planning) ohne manuelle Eingriffe.

- **Schedule Templates (Fahrplanvorlagen)**
  - `ScheduleTemplateService` verwaltet Fahrplan-Blueprints inkl. Stoplisten, Services, Recurrence (z. B. alle 30 min). Ein dedizierter Template-Hub (Schedule-Template-Feature) erlaubt Bearbeitung und Vorschau.
  - `OrderPositionDialog` (Tab „Fahrplan (Serie)“) nutzt diese Templates: Auswahl per `mat-select`, Parametrisierung (Start/Endzeit, Takt, Nameprefix, OTN, Tags). `PlanAssemblyDialog` dient zur Feinanpassung, `OrderPlanPreviewComponent` zeigt Stats/Warnungen.
  - Beim Speichern ruft `createPlanItems()` -> `OrderService.addPlanOrderItems` -> `trainPlanService.createPlansFromTemplate`. Jedes generierte Order Item referenziert `linkedTemplateId` + `linkedTrainPlanId`, sodass Rückverfolgbarkeit und spätere Analysen möglich sind.

- **Template-Empfehlungen & Einbindung**
  - Das Order-Panel „Empfehlungen“ (`OrderTemplateRecommendationComponent`) analysiert aktuelle Filter (Tags, Suchtokens) und ruft `BusinessTemplateService.recommendationsForContext`. So erscheinen passende Business Templates direkt neben den Order Cards.
  - `OrderPositionDialog` zeigt bei Auswahl eines Templates Hinweise (`automationHint`, Label, Timeline). Business Templates lassen sich auch im Dialogmodus „Vorlage“ nutzen, um unmittelbar nach der Positionserstellung passende Geschäfte inklusive optionaler Automationen auszulösen.
  - Schedule Templates stehen ebenfalls im `PlanAssemblyDialog` zur Verfügung; Anpassungen können als neue Vorlage gespeichert werden, wodurch Best Practices in zukünftigen Orders wiederverwendbar sind.

- **Zusammenspiel**
  - Business Templates liefern wiederkehrende Prozessstrukturen (Aufgaben, Due-Dates, Tags) und können durch Automationen an TTR-Phasen gekoppelt werden.
  - Schedule Templates stellen wiederkehrende Fahrplanstrukturen bereit; Order Items behalten die Template-ID, sodass KPI/Insights (z. B. welche Serien laufen) ableitbar sind.
  - Beide Template-Typen sind konfigurierbar, nutzen Signals/Storage zur Persistenz und sind über mehrere UI-Bereiche erreichbar (Geschäfte, Orders, Template-Hubs), wodurch Disponent:innen konsistente Vorgehensweisen etablieren können.

### 4.12 Fahrplanarchiv & Referenzkalender

- **Archiv-Übersicht**
  - Route `/archive` lädt `ArchivePageComponent` mit zwei Tabs:
    1. **Fahrpläne** (`TrainPlanListComponent`): filterbare Liste aller `TrainPlan`-Instanzen (Rollout, TTT, Import, manuell). Filter: Status, Quelle, Responsible, Volltext; Sortierungen (Update, Zugnummer, Status, Titel). Cards zeigen Stop-Reihen, Rolling-Stock-Aktivitäten, Kalenderdaten und Links zu Order Items.
    2. **Referenzkalender** (`TrafficPeriodListComponent`): Verwaltung sämtlicher `TrafficPeriod`-Einträge inkl. Regeln/Varianten. Gruppierung nach Tags (z. B. `order:<id>`, `import:<groupId>`, `timetable-year:<label>`), Filter nach Typ, Tags, Suche, Sortierung (Name/Update). Aktionen: Bearbeiten, Duplizieren, Löschen.
  - Query-Parameter `view` (`plans|calendars`) setzen den Tab; `highlightPlan` / `highlightPeriod` scrollen temporär zu einem Eintrag (verwendet für Deep Links aus Order/Business-UI).

- **Train Plans im Archiv**
  - Entstanden durch Order-Workflows (`createServiceItem`, `createPlanItems`, `createManualPlanItem`, `createImportedPlanItems`), Plan-Modifikationen, RailML-Importe.
  - `TrainPlanService` speichert Metadaten (Titel, Zugnummer, Quelle, Status, Responsible), Kalender (`validFrom`, `validTo`, `daysBitmap`), Stoplisten (Sequenz, Offsets, Aktivitäten), Rolling-Stock, technische/Route-Metadaten, `trafficPeriodId`, `linkedOrderItemId`.
  - Archiv unterstützt Filter/Suche, Sortierung, Responsible-Filter, Scroll-to-highlight und Cross-Link in Order Cards (z. B. `openOrderItem`). Lösch-/Exportaktionen können hier ergänzt werden.

- **Referenzkalender (Traffic Periods)**
  - `TrafficPeriodService` verwaltet Perioden und Regeln:
    - Regeln (`TrafficPeriodRulePayload`): Name, `selectedDates`, `excludedDates`, `variantType` (`series`, `special_day`, `block`, `replacement`), `variantNumber`, Scope (`commercial`, `operational`, `both`), Reason, Primary-Flag.
    - Einträge enthalten Details wie Name, Typ (`standard`, `special`, `construction`), Description, Responsible, Tags, `timetableYearLabel`.
  - Erstellpfade:
    - **Service-Dialog:** `createSingleDayPeriod` für jede Leistung (Tags `order:<id>:service:<slug>`).
    - **Manuelle Fahrpläne:** `createManualTrafficPeriod` generiert Spannenkalender mit Tags `manual:<slug>`.
    - **RailML-Import:** `ensureCalendarsForImportedTrains` gruppiert Züge nach `groupId`, erstellt Regeln mittels `buildGroupTrafficPeriodRules`, Tags `import:<groupId>`.
    - **Plan-Serien:** `createTrafficPeriodForPlanDates` (OrderService) legt bei Bedarf Perioden an, falls kein `trafficPeriodId` vorliegt.
    - **Traffic-Period-Editor:** UI zum Bearbeiten/Duplizieren/Löschen; Persistenz via `MOCK_TRAFFIC_PERIODS` + Local Storage.
  - Archiv-UI listet Perioden nach Gruppen (z. B. pro Auftrag/Jahr), zeigt Tag-Badges, Filterchips und ermöglicht Highlight via Query (`highlightId`).

- **Tagging & Traceability**
  - `buildArchiveGroupTags(groupId, label, origin)` sorgt für konsistente Tags (z. B. `order:<id>`, `service:<slug>`, `manual:<slug>`, `import:<groupId>`), sodass Pläne/Kalender eindeutig gefiltert werden können.
  - `TrafficPeriodService` ergänzt automatisch `timetable-year:<label>`; Order Items übernehmen `trafficPeriodId`, wodurch Filter wie `timetableYearLabel` konsistent bleiben.
  - Archivmetadaten erscheinen in Order Cards (Kalendername, Tag-Hinweise) und Business Cards (Positionen mit Kalenderinfo).

- **Integration in Flows**
  - Order-Dialoge erstellen bei Bedarf Referenzkalender automatisch; Nutzer:innen müssen sich nicht manuell um Kalendermanagement kümmern.
  - Archiv und Order-Bereich sind über Query-Parameter verbunden (z. B. Button „Archiv öffnen“ setzt `highlightPlan` oder `highlightPeriod`).
  - Signals (`TrainPlanService`, `TrafficPeriodService`) sorgen dafür, dass Änderungen (z. B. gelöschte Pläne, neue Perioden) sofort in allen UI-Bereichen sichtbar werden.

## 5. Domaenenobjekte und Datenquellen

### 5.1 Order

| Feld | Beschreibung |
| --- | --- |
| `id` | Einzigartige Kennung (optional manuell gepflegt). |
| `name` | Sichtbarer Titel in Order Cards und Listen. |
| `customerId`/`customer` | Referenz auf `CustomerService` oder freier Anzeigename. |
| `tags` | Freitags zur Filterung, Insights und Automatismen. |
| `items` | Liste aller `OrderItem`. |
| `comment` | Interne Notizen. |
| `timetableYearLabel` | Standardjahr fuer Positionen. |

### 5.2 OrderItem

| Feld | Beschreibung |
| --- | --- |
| `id`, `name`, `type` | Eindeutige Identitaet; Typ `Leistung` oder `Fahrplan`. |
| `tags`, `responsible`, `deviation` | Kontext fuer Filter, Health und Aufmerksamkeit. |
| `start`, `end` | ISO-Zeitfenster je Position. |
| `trafficPeriodId`, `validity` | Angaben zum Kalender (Boegen, Ausschluesse). |
| `linkedBusinessIds`, `linkedTemplateId`, `linkedTrainPlanId` | Relationen zu Business Templates, Geschaeften und Train-Plans. |
| `serviceType`, `fromLocation`, `toLocation` | Servicestammdaten. |
| `timetablePhase` | Aktuelle TTT-Phase (`bedarf`…`archived`). |
| `generatedTimetableRefId`, `originalTimetable` | Snapshots fuer importierte/abgeleitete Fahrplaene. |
| `timetableYearLabel` | ggf. abweichendes Jahr auf Item-Ebene. |

### 5.3 Business und Templates

- `Business` (Status `neu`, `pausiert`, `in_arbeit`, `erledigt`) enthaelt Beschreibung, Due-Dates, Assignment und optionale Dokumente.
- `BusinessTemplate` definiert Titel, Beschreibung, Instructions, empfohlene Zustaendigkeit, Due-Rule (Anchor, Offset), Tags und Steps.
- `BusinessTemplateAutomation` (siehe `business-template.model.ts`) nutzt Conditions aus Feldern `itemTag`, `itemType`, `ttrPhase`, `timetablePhase` in Kombination mit Operatoren `includes`, `excludes`, `equals`, `notEquals`.
- Phase-spezifische Templates (`TTR_PHASE_TEMPLATE_DEFINITIONS`) liefern Label, Zeitfenster (Start/Ende, Einheit, Bucket: Tag/Woche/Jahr/Stunde), Timeline-Referenz (`fpDay`, `operationalDay`, `fpYear`), Auto-Create-Flag und optionale Conditions.

### 5.4 Filterdefinition

`OrderFilters` (persistiert unter `orders.filters.v2`) bestimmen alle Listenansichten:

| Filter | Wertebereich | Bemerkung |
| --- | --- | --- |
| `search` | Freitext inkl. Token `tag:` und `resp:` | Wird mit `FormControl` synchronisiert und erzeugt Vorschlaege. |
| `tag` | `all` oder Tag ohne `#` | Pills im Filterbereich. |
| `timeRange` | `all`, `next4h`, `next12h`, `today`, `thisWeek` | Nutzt relative Zeitfenster. |
| `trainStatus` | `all` oder Timetable-Phase | Klicks auf Phase-Chips der Order Card toggeln diesen Filter. |
| `businessStatus` | `all` oder BusinessStatus | Ermoeglicht Fokussierung auf z. B. blockierte Geschaefte. |
| `trainNumber` | String | Freitext. |
| `timetableYearLabel` | `all` oder Jahr | Bound an Tag/Timeline-Suche. |
| `linkedBusinessId` | ID | Wird per Query-Parameter `?businessId=` gesetzt. |
| `fpRangeStart`/`fpRangeEnd` | ISO-Datum | Spannenauswahl fuer Fahrplantage. |
| `timelineReference` | `fpDay`, `fpYear`, `operationalDay` | Steuert TTR-Phasen-Interpretation. |
| `ttrPhase` | `all` oder Phase | Filtert Buckets wie Rolling Planning, Short-Term usw. |

Zusatzspeicher: `orders.presets.v1` (Filter-Presets), `orders.insightsCollapsed.v1` (eingeklappte Insights).

### 5.5 Status-Referenzen

Dieses Projekt unterscheidet – in Anlehnung an das SOB-Fachkonzept zum Umgang mit internen und externen Status – mehrere Statusarten:

| Kategorie | Werte | Verwendung |
| --- | --- | --- |
| Timetable-Phasen (extern/prozessual) | `bedarf`, `path_request`, `offer`, `contract`, `operational`, `archived` | Externe/TTT-orientierte Sicht auf den Lebenszyklus eines Fahrplans bzw. PathRequests. Anzeige auf Cards, Bulk-Status-Dialog, Filter. |
| TTR-Phasen (Prozessfenster) | `annual_request`, `final_offer`, `rolling_planning`, `short_term`, `ad_hoc`, `operational_delivery`, `unknown` | Hero-Metriken, TTR-Chips, Automation-Trigger (Zeitfenster/Buckets). |
| Timeline-Referenzen | `fpDay`, `operationalDay`, `fpYear` | Steuern Zeitfenster/Bucket-Auswahl bei Automation und Filtern. |
| Business-Status (interne Tätigkeiten) | `neu`, `in_arbeit`, `pausiert`, `erledigt` | Fortschritt einzelner Geschäfte (Aufgabenpakete). Steuert Geschäftsübersicht, Filter, Bulk-Statuswechsel. |
| Order-Prozessstatus (Auftragsebene) | `auftrag`, `planung`, `produkt_leistung`, `produktion`, `abrechnung_nachbereitung` | Zeigt, in welchem SOB-Prozessschritt sich ein Auftrag befindet (Klammer, Planung, Produkt/Leistung, Produktion, Nachbereitung/Abrechnung). Wird auf der Auftragskarte als Pipeline/Badge visualisiert. |
| Interne Bearbeitungsstatus (OrderItem/PathRequest) | `in_bearbeitung`, `freigegeben`, `ueberarbeiten`, `uebermittelt`, `beantragt`, `abgeschlossen`, `annulliert` | Interne Status für Auftragspositionen/PathRequests: steuern Übergaben, Rückwürfe, technische Übermittlung und Abschluss/Annullierung. Ergänzen die externen Timetable-Phasen. |

### 5.6 Interne und externe Status – Modellierung

#### 5.6.1 Externe Fahrplan-/TTT-Status

- `TimetablePhase` bildet die extern sichtbaren Prozessschritte eines Fahrplans bzw. PathRequests ab und lehnt sich **an das TTT-Statusmodell an**, ist aber eine **bewusst vereinfachte SOB-Abstraktion**:
  - `bedarf` – interner Bedarf, noch kein PathRequest an TTT.  
  - `path_request` – PathRequest wurde gestellt und (aus TTT-Sicht) bestätigt.  
  - `offer` – Draft/Final Offer ist eingetroffen.  
  - `contract` – Angebot wurde angenommen, Trasse ist vertraglich gebucht („Booked“).  
  - `operational` – Fahrplan läuft in der operativen Produktion („Used“).  
  - `archived` – Fahrplan ist technisch abgeschlossen; im Mock wird dies im UI als „Cancelled“ zusammengefasst.
- Diese Phasen werden:
  - in der Auftragskarte als Fahrplanstatus-Chips aggregiert,  
  - in `OrderItemListComponent` pro Position angezeigt,  
  - im Dialog „Status aktualisieren“ für Bulk-Übergänge genutzt.

- Die folgende Tabelle zeigt das grobe Mapping zum TTT-Statusmodell (Path-Status) aus der Schnittstellenspezifikation:

  | Mock `TimetablePhase` | Entsprechende TTT-Status (Path) | Bemerkung |
  | --- | --- | --- |
  | `bedarf` | – | rein interner Vorbereitungsstatus, noch kein TTT-Request. |
  | `path_request` | MessageStatus `Creation`/`Modification` eines PathRequest | Mix aus Request-Sicht und Path-Sicht; im Mock nur als Phase sichtbar. |
  | `offer` | `Draft`, `Offered` | sowohl Draft Offer als auch Final Offer werden zusammengefasst. |
  | `contract` | `Booked` | entspricht „Final Offer angenommen“ / „Pre-Accepted bestellt“. |
  | `operational` | `Used` | Path/Trasse wurde genutzt. |
  | `archived` | `Cancelled` (Tage fahren nicht) oder historisierte Used/Booked-Paths | im Mock als allgemeiner Archiv-/Stornozustand verwendet. |

- TTT kennt zusätzlich die Status **`Refused`**, **`Not Available`** und **`Shadow`**, die im Mock **nicht separat** abgebildet werden:
  - `Refused` (Final Offer abgelehnt) könnte fachlich in Kombination mit internen Bearbeitungsstatus und Geschäftsstatus modelliert werden.  
  - `Not Available` (Trasse aktuell nicht verfügbar, neue Offerte in Arbeit) würde sich eher in den Milestones/Events widerspiegeln.  
  - `Shadow` (Modification in Bearbeitung, bisherige Trasse gilt noch) wäre eine eigene, noch nicht implementierte Zustandsvariante.  

- Eine spätere Anreicherung mit „rohen“ TTT-Statuswerten (z. B. `rawTttStatus`, `pathStatus`, `pathRequestStatus`) bleibt möglich, ist aber nicht Teil dieses Mocks.

#### 5.6.2 Order-Prozessstatus (Auftragsebene)

- Jeder `Order` erhält zusätzlich einen Prozessstatus:

  ```ts
  export type OrderProcessStatus =
    | 'auftrag'
    | 'planung'
    | 'produkt_leistung'
    | 'produktion'
    | 'abrechnung_nachbereitung';
  ```

- Bedeutung im Sinne des SOB-Fachkonzepts:
  - `auftrag` – Auftrag (Klammer/Sammeltopf) ist angelegt, aber noch nicht in die fachliche Planung überführt.  
  - `planung` – Trassen, Leistungen und Varianten werden geplant (Jahresfahrplan, Extrazüge etc.).  
  - `produkt_leistung` – Produkt/Leistung ist inhaltlich fertig geplant und bereit für die operative Umsetzung.  
  - `produktion` – Leistungen laufen in der operativen Produktion.  
  - `abrechnung_nachbereitung` – Nachbereitung/Abrechnung läuft oder ist abgeschlossen.

- UI-Auswirkungen:
  - Auftragskarten zeigen den aktuellen Prozessschritt als Badge/Pipeline (z. B. „Planung“, „Produktion“).  
  - Filter/Szenarien können gezielt auf bestimmte Prozessschritte einschränken (z. B. „alle Aufträge in Abrechnung“).

#### 5.6.3 Interne Bearbeitungsstatus (Position/PathRequest)

- Für `OrderItem` wird ein optionaler interner Bearbeitungsstatus eingeführt:

  ```ts
  export type InternalProcessingStatus =
    | 'in_bearbeitung'
    | 'freigegeben'
    | 'ueberarbeiten'
    | 'uebermittelt'
    | 'beantragt'
    | 'abgeschlossen'
    | 'annulliert';
  ```

- Semantik (verkürzt aus dem SOB-Fachkonzept übernommen):
  - `in_bearbeitung` – Tätigkeit läuft; Daten werden erfasst/überarbeitet.  
  - `freigegeben` – fachlich geprüft, bereit zur Übergabe an nächsten Schritt (Team/Stelle).  
  - `ueberarbeiten` – Rückwurf in vorherigen Schritt; es fehlen Informationen oder es muss zwischen Varianten entschieden werden (Begründung Pflicht).  
  - `uebermittelt` – PathRequest wurde technisch abgeschickt, TTT-Receipt steht noch aus.  
  - `beantragt` – PathRequest ist gesendet und per ReceiptConfirmation bestätigt; Entscheidung der PIM steht noch aus.  
  - `abgeschlossen` – fachlicher Abschluss der Position (z. B. nach Annahme des Final Offer und Übergang in die Produktion).  
  - `annulliert` – Position/Bestellung wurde storniert; relevant für Auswertungen zu Stornokosten.

- Zusammenspiel mit `TimetablePhase`:
  - `TimetablePhase` beschreibt die externe Sicht (TTT/Trasse).  
  - `InternalProcessingStatus` beschreibt die interne Bearbeitung derselben Position.  
  - Beispielhafte Kombinationen:
    - `internalStatus = 'beantragt'`, `timetablePhase = 'path_request'`.  
    - `internalStatus = 'freigegeben'`, `timetablePhase = 'offer'`.  
    - `internalStatus = 'abgeschlossen'`, `timetablePhase = 'contract'` oder `operational`.

- UI-Ideen (Scope für spätere Ausbaustufen, Mock kann Teilmengen zeigen):
  - Chips oder Badges pro Position, die internen Status in Klartext („In Bearbeitung“, „Freigegeben“, …) anzeigen.  
  - Aktionen „Freigeben“, „Überarbeiten“, „Annullieren“ direkt aus der Auftragskarte/Positionsliste.  
  - Optional: Filter für interne Status (z. B. „alle Positionen in Überarbeitung“).

#### 5.6.4 CPEx-Status

- CPEx-Status sind im SOB-Fachkonzept als weitere externe Statusquelle beschrieben.  
- Sie sind **explizit nicht Teil dieses Mocks** und werden in dieser Spezifikation nur als Kontext erwähnt.  
- Eine spätere Anbindung könnte über eigene Felder und Mappings erfolgen, ist hier aber out of scope.

## 6. Funktionaler Umfang

### 6.1 Landing View & Hero-Metriken

- Metric-Karten (`inventory_2`, `view_list`, `event`, `warning`, `category`, `sync_alt`, `bolt`, `flash_on`) zeigen Werte aus `OrderListComponent.computeHeroMetrics`.
- Aktionen pro Karte setzen passende Filter (`thisWeek`, `ttrPhase=short_term`, etc.).
- Health Insight aggregiert Attention- und Upcoming-Anteile; Tonalitaet: `critical >= 30%`, `warn >= 12%`, sonst `ok`.
- Skeleton-Placeholder (6 Cards) und `isViewTransitioning` Flag glätten UI-Updates.

### 6.2 Filterleiste, Suche, Presets

- Filter-Bar kombiniert Chips, Datepicker, Timeline-Referenz, TTR-Bucket-Auswahl, Tag/Responsible-Pills und Query-Param-Synchronisierung (`businessId`, `highlightItem` fuer Auto-Scroll).
- Suchfeld akzeptiert Token `tag:<value>` und `resp:<value>` sowie Freitext; Vorschlagsliste zeigt Top-Tags/-Verantwortliche (max. 8 Treffer) inkl. Icons und Count.
- Presets koennen gespeichert, umbenannt, geloescht werden; Aktivitaet wird aufgehoben, sobald Filterwerte vom Preset abweichen.
- Timeline-Referenz-Label/Hints erklaeren `fpDay` (Planbezug), `fpYear` (Jahresfrist), `operationalDay` (Produktion).
- Range-Chips fuer Fahrplanfenster zeigen `ab`, `bis` oder Zeitraum (Intl-Date-Formatierung).

### 6.3 Insights, Tag/Responsible-Stats und Template Panel

- Top-3-Tags/-Responsibles werden als Insight-Kacheln dargestellt; Klick setzt Filter oder Search-Tokens.
- Team-Insights (Beliebte Tags, Top-Verantwortliche, Kontextkarte) reagieren auf aktuelle Filter und koennen eingeklappt werden (persistiert).
- Collaboration-Context liefert textliche Hinweise (Icon, Message, Hint) fuer Teamarbeit.
- Optionales Template-Recommendation-Panel analysiert aktive Filter (`tag`, `#`-Tokens, Premium-Suche) und zeigt passende Business Templates an; Panel kann geschlossen werden.

### 6.4 Order Cards & Item-Interaktionen

- Karten enthalen Header mit Name, Kunde, Tag-Badges, Fahrplanjahr und Health-Snapshot (`tone`, `label`, `icon`, `caption`, Prozentbalken). `OrderHealth` basiert auf Items: `attentionRatio >= 0.3 -> Kritisch`, `>= 0.12 -> Beobachten`, sonst `Planmaessig/Stabil`.
- Auto-Expansion: Sobald ein beliebiger Filter aktiv ist, oeffnen sich Karten automatisch; Entfernen aller Filter klappt rueckwaerts zu (Signal `autoExpandedByFilter`).
- Section-Badges:
  - Business-Status (Neu/Pausiert/In Arbeit/Erledigt) mit Klick zum Filtern.
  - Timetable-Phasen-Chips (TTT-Phasen Draft/Path Request/Offered/Booked/Used/Cancelled, inkl. Clear-Action).
  - TTR-Phase-Badge-Liste mit Tooltip (`window`, `hint`, Reference-Label) und Toggle/Reset.
  - Interne Bearbeitungsstatus (z. B. In Bearbeitung, Freigegeben, Beantragt, Abgeschlossen, Annulliert) als aggregierte Infopills; dienen der Übersicht, werden im Mock aber noch nicht als Filter verwendet.
  - Varianten (`originalTimetable.variants`), Fahrplanjahre pro Item.
- Customer-Details werden ueber `CustomerService` nachgeladen und im Card-Body angezeigt.
- Highlight von Einzelpositionen (Query `highlightItem`) scrollt automatisch und setzt `highlightItemId`.

### 6.5 Auswahlmodus, Bulk-Aktionen und Dialoge

- `selectionMode` erlaubt Mehrfachselektion pro Card (Checkboxen, Zaehlung via `selectedCount`); Leeren deaktiviert den Modus.
- `submitSelected` bzw. `submitSingle` ruft `OrderService.submitOrderItems` auf und setzt Timetable-Phase auf `path_request`. Feedback via `MatSnackBar`.
- `OrderPositionDialogComponent` deckt vier Tabs ab:
  1. **Service**: Pflichtfelder (`serviceType`, Locations, Zeitfenster), Kalender (Jahr, konkrete Tage, Exklusion), Deviation, Tags.
  2. **Plan**: Template-basierte Takte (`ScheduleTemplateService`), Start-/Ende, Intervall, Laufnummern (OTN), Kalenderdaten, Tags.
  3. **Manual Plan**: Freie Eingabe von Zugnummern, Responsible, Tags + Kalender.
  4. **Import**: RailML-Suche mit Filtern (`start`, `end`, `templateId`, Abweichungsfilter) sowie Import-Optionen (TrafficPeriod, Name, Responsible, Tags).
- Plan-Workflows binden `PlanAssemblyDialog` und `OrderPlanPreviewComponent` fuer Vorschauen, Stats und Stop-Bearbeitung ein; Verkehrskalender kommen aus `TrafficPeriodService`.
- Business-Abschnitt im Dialog erlaubt Linking zu bestehenden Geschaeften oder Anlegen via Template (inkl. optionaler Automations-Regeln, Standard `enableAutomations=true`).
- `OrderLinkBusinessDialog` -> Geschaeft suchen (Titel/ID/Zustaendige), Items aus Liste toggeln, Sammel-Linking.
- `OrderStatusUpdateDialog` -> Mehrfachauswahl, Phase-Tiles (Icons), Default-Phase = erste vorhandene Item-Phase.
- `OrderCreateDialog` -> Minimal-Formular (Name Pflicht, optionale ID, Kunde, Tags, Kommentar, Fahrplanjahr). Hilfstexte erklaeren Felder. Tags werden dedupliziert und getrimmt.

#### 6.5.1 Dialog „Auftragsposition hinzufügen“

- **Grundlayout:** `mat-dialog` mit Titel `Auftragsposition hinzufügen`, Body bestehend aus Tab-Gruppe (`mat-tab-group`) und darunterliegenden Meta-Sektionen (Planvorschau, Kalender, Geschäftsverknüpfung). `modeControl` synchronisiert Tabs (`service`, `plan`, `manualPlan`, `import`).
- **Tab-Aufbau:**
  1. **Leistung:** Kombination aus `OrderItemGeneralFieldsComponent` (Name, Verantwortlich, Bemerkung, Tags) und `OrderItemServiceFieldsComponent` (Leistungstyp, From/To, Start/Ende). Hinweise erklären, dass Tage im Referenzkalender gewählt werden. Time Inputs nutzen `type="time"`, Beschreibungen erläutern Bedeutung (z. B. Endzeit < Startzeit → Folgetag).
  2. **Fahrplan (Serie):** Enthält Stroked-Button zum Öffnen des Template-Creators, gefolgt von Formularfeldern für Vorlage, Start-/Endzeit, Takt, Nameprefix, Verantwortliche, OTN/Intervall, Tags. Alle Felder besitzen `matTooltip`-Buttons (`help_outline`). Unterhalb befindet sich ein Kalenderblock (`ReferenceCalendarInlineFormComponent`) und eine Preview-Sektion (`OrderPlanPreviewComponent`) mit Stats (Züge, Zeitraum, OTN, Erste/Letzte) sowie Warnungen/Sample-Abfahrten. Rechts daneben: Inline-Panel für `OrderPlanPreviewComponent`.
  3. **Fahrplan (Manuell):** Bietet Button „Fahrplan zusammenstellen“ (öffnet `PlanAssemblyDialogComponent`), Option zum Laden/Bearbeiten einer Stopliste (`manualTemplate`). Nutzer:innen geben Zugnummer, Name, Responsible, Tags ein; Kalenderhinweis identisch mit Service-Tab. Wenn eine manuelle Vorlage aktiv ist, zeigt ein Badge Anzahl Halte und Buttons zum Bearbeiten/Reset.
  4. **Fahrplan (Import):** Oberer Bereich mit File-Input (RailML), Reset-Button, Fehlermeldungen. Links Filterformular (`OrderImportFiltersComponent`), rechts Ergebnisliste mit accordionartigen Karten: Kopf (Zugnummer, Datum, Abfahrtszeit, Checkbox zum Auswählen), Matching-Panel (Template, Abweichungen, Toleranz), Details (Haltevergleich mit Δ-Spalten). Optionen-Form darunter erlaubt Zuweisung von Referenzkalender, Namenspräfix, Responsible, Tags. Import-Preview zeigt Map aus Template-Farben vs. importiertem Zug; Buttons für „nur abweichende Züge“ etc.
- **Kalender-Integration:** Alle Modi nutzen `ReferenceCalendarInlineFormComponent` mit Tabs „Kalender“ und „Ausnahmen“. Pflichtvalidierung (`nonEmptyDates`) sorgt dafür, dass mindestens ein Fahrplan-Tag gesetzt wird; Fehlerhinweise erscheinen direkt unter dem Calendar-Widget.
- **Fehler- und Statuskommunikation:** `errorMessage()` wird unterhalb der Tabs angezeigt (rote Textzeile). Bei fehlendem Fahrplan (manuell) oder nicht gewähltem Template (Serie) erscheinen Placeholder mit Icons (`visibility`, `info`).
- **Business-Verknüpfung:** Unter den Tabs folgt eine eigenständige Sektion mit Header, Beschreibung und Toggle-Group (`Ohne Geschäft`, `Bestehend`, `Vorlage`). Abhängig vom Modus erscheinen:
  - Dropdown für bestehendes Geschäft (inkl. Validation).
  - Template-Auswahl + Felder für Custom Title, Zieldatum, Notiz, Automations-Switch + Checkboxliste der verfügbaren Regeln (deaktiviert bei ausgeschalteten Automationen).
  - Slide-Toggle `enableAutomations` steuert, ob die Checkboxliste aktiv ist, plus Statushinweis.
- **Dialog-Actions:** Buttons `Abbrechen` (schließt Dialog) und `Speichern`. `save()` wertet aktiven Modus aus und ruft entsprechende Create-Methoden; Validierungsfehler markieren Form Controls (`markAllAsTouched`). Erfolgreiche Vorgänge schließen den Dialog mit `true` und lösen Business-Verlinkungen aus.
- **Usability-Aspekte:** Inline-Hilfen (Tooltips, Beschreibungen, Placeholders) verdeutlichen Input-Bedeutungen. Buttons sind stets mit Icons versehen (z. B. `schema`, `upload_file`, `delete_sweep`). Abschnitte sind logisch gestapelt (Tab, Kalender, Preview, Business, Fehler, Actions) und passen sich `maxWidth: 95vw` an, um auf kleineren Screens zu funktionieren.

#### 6.5.2 Funktionaler Ablauf & Datenfluss

- **Gemeinsame Grundlagen**
  - `save()` verzweigt anhand des aktiven Tabs (`mode()`), markiert bei Invalidität alle Controls (`markAllAsTouched`) und schreibt Fehlertexte in `errorMessage`.
  - `ReferenceCalendarInlineFormComponent` liefert `calendarDates`/`calendarExclusions`, die über Dialog-Hilfsfunktionen normalisiert werden und als Input für `OrderService` dienen.
  - `ensureBusinessSelectionValid()` prüft den Geschäftsmodus. `applyBusinessLink(createdItems)` hängt die erzeugten Item-IDs an ein bestehendes Geschäft (`BusinessService.setLinkedOrderItems`) oder instanziiert eine Vorlage (`BusinessTemplateService.instantiateTemplate`) inkl. optionaler Automationstrigger (`onAutomationToggle`-Auswahl).
  - Jede `create*`-Methode ruft einen passenden OrderService-Entry-Point auf, der Items erzeugt, die `_orders`-Signal aktualisiert und (falls nötig) Traffic Periods / Timetable-Jahre konsistent hält.

- **Leistung (Service)**
  1. `createServiceItem()` iteriert über alle ausgewählten Kalendertage.
  2. Pro Tag entsteht via `trafficPeriodService.createSingleDayPeriod` ein Referenzkalender (Typ `special_day`), getaggt nach Auftrag.
  3. Aus Zeitfeldern (`start`/`end`) werden ISO-Zeitstempel berechnet. Daraus baut der Dialog ein `CreateServiceOrderItemPayload`.
  4. `OrderService.addServiceOrderItem` normalisiert Name, Tags, Fahrplanjahr (`ensureOrderTimetableYear`) und fügt ein Item vom Typ `Leistung` ein.
  5. Abschließend (optional) `applyBusinessLink`, damit alle erzeugten Leistungen mit einem Geschäft verknüpft werden.

- **Fahrplan (Serie)**
  1. `createPlanItems()` verwendet Formwerte (Template, Zeitfenster, Takt, Nameprefix, Verantwortliche, OTN, Tags) sowie Kalenderdaten.
  2. Fehlt ein Traffic-Period, erzeugt der Service über `createTrafficPeriodForPlanDates` eine Spannungsperiode.
  3. `OrderService.addPlanOrderItems` ruft `trainPlanService.createPlansFromTemplate` auf; daraus entstehen mehrere `TrainPlan`-Objekte.
  4. Für jeden Plan wird ein `OrderItem` erstellt (Typ `Fahrplan`), inklusive Template-ID, `linkedTrainPlanId`, Timetable-Snapshot (`ensureTimetableForPlan`), Varianten/Stops und Tags.
  5. `linkTrainPlanToItem` verbindet jeden TrainPlan bidirektional mit dem Item, sodass spätere Updates (Plan Hub) referenzierbar sind.

- **Fahrplan (Manuell)**
  1. `PlanAssemblyDialog` liefert `manualTemplate` (Stops mit Zeiten). Ohne diese stops bricht `createManualPlanItem()` ab.
  2. Der Dialog erstellt anhand der Kalenderdaten einen Traffic-Period (`createManualTrafficPeriod`) und ruft `trainPlanService.createManualPlan`.
  3. `OrderService.addManualPlanOrderItem` transformiert den Plan in ein `OrderItem`, setzt Tags/Responsible/Name und generiert einen Timetable.
  4. Das Item wird gespeichert und der TrainPlan über `linkTrainPlanToItem` angebunden.

- **Fahrplan (Import/RailML)**
  1. RailML-Dateien werden geparst und als `ImportedRailMlTrain[]` gespeichert; Filter legen fest, welche Züge sichtbar/selektiert sind.
  2. `createImportedPlanItems()` läuft über alle markierten Züge und ruft `OrderService.addImportedPlanOrderItem`.
  3. Pro Zug entsteht über `trainPlanService.createManualPlan` ein Plan mit importierten Stops; Fahrplanjahr stammt aus RailML, TrafficPeriod oder Plan.
  4. Neue Items erhalten Nameprefix, Responsible, Tags und optional `parentItemId` (wenn Serie). Wieder sorgt `linkTrainPlanToItem` für Konsistenz.

- **Fahrplan (Capacity Supply / TTT-Capacity)**  
  - Fachlich vergleichbar zum RailML-Import ist ein geplanter Import von Kapazitätsinformationen aus dem TTT-Capacity-Supply-Prozess.  
  - Im späteren Produkt könnten daraus automatisch Fahrplan-/Kapazitätsobjekte erzeugt und im Auftragsmanagement weiterverarbeitet werden.  
  - Im Mock ist diese Schnittstelle bewusst nicht umgesetzt – als Platzhalter dient aktuell der RailML-Import. Capacity Supply wird daher **nicht** als eigene TTR-Phase angezeigt, sondern als externe Quelle für zukünftige Fahrplanimporte verstanden.

- **Business-Verknüpfung**
  - Modus „Bestehend“: `businessService.setLinkedOrderItems` erweitert die Itemliste eines bestehenden Geschäfts.
  - Modus „Vorlage“: `BusinessTemplateService.instantiateTemplate` erstellt neues Geschäft, wendet Due-Rule/Assignments an und hängt Tags (`template:`, `phase:`) an. Falls Automationen aktiv sind, werden ausgewählte Regeln geloggt (`logAutomationRun`).
  - Modus „Ohne Geschäft“ überspringt diesen Schritt.

- **Fehler- und Erfolgsbehandlung**
  - Jede `create*`-Methode fängt Exceptions ab und setzt `errorMessage` (z. B. „Bitte einen Leistungstyp angeben“).
  - Nach erfolgreicher Erstellung und optionalem Business-Link ruft der Dialog `dialogRef.close(true)`, wodurch die Order Card ihre Items aktualisiert und ggf. Filter/Selection unverändert beibehält.

### 6.6 Echtzeit und Zusammenarbeit

- Event-Stream `GET /planning/stages/:stageId/events` (SSE) sendet `PlanningStageRealtimeEvent`; Client fuehrt `userId` (stabil) + `connectionId` (pro Tab).
- `clientRequestId = <userId>|<connectionId>|...` erlaubt Backend, Echo-Events zu filtern (`sourceConnectionId`).
- Bei Versionssprüngen ladt das Frontend Snapshots ueber `GET /planning/stages/:stageId`.
- Plantafeln koennen in externem Fenster (`/#/planning/external?stage=<>&resources=...`) geoefnet werden; jedes Fenster haelt eigene Connection und synchronisiert Events ohne doppelte Anwendung.

### 6.7 Mock-Daten & Testbarkeit

- `src/app/core/mock/mock-orders.mock.ts` enthaelt realistische Auftraege inkl. `ORD-TTR-DEMO`, das alle TTR-Phasen abdeckt; ideal fuer Automations-Playground.
- Services fuer Kunden, Geschaefte, Fahrplanjahre, Traffic Periods stellen konsistente Lookup-Daten bereit.
- Default-Konfiguration (Dev-Server) nutzt Mock-Daten, sobald kein Backend verfuegbar ist.

## 7. Geschaefts-Automatismen

- `TtrBusinessAutomationService` beobachtet `orderService.itemTtrPhaseIndex()` und fuehrt Aktionen aus, sobald Items neue Phasen erreichen.
- Ablauf:
  1. Klaerung, ob Phase != `unknown`, ob Automations-Flag fuer Phase aktiv (`business.phaseAutomation.v1`) und ob Template-Definition existiert.
  2. Ermittlung des Referenzdatums (`getItemReferenceDate`) je Phase-Definition (`timelineReference`).
  3. Pruefung, ob `referenceDate` im definierten Zeitfenster (`window unit + start/end, konvertiert in Minuten`) liegt.
  4. Condition-Check ueber `AutomationCondition`-Liste.
  5. Bucket-Key pro Definition (`bucket: year|week|day|hour`) -> kombiniert mit Template-Tag (`template:<id>`) und Phase-Tag (`phase:<phaseId>`).
  6. Falls Business mit Tag-Kombination existiert, wird Itemliste erweitert; andernfalls erstellt `BusinessTemplateService.instantiateTemplate` ein neues Business inkl. Tags, Assignment, Due-Date (Offset) und Logging.
- Automation-Runs werden mit Status/Meldung protokolliert und als Feed in der Template-Hub-UI angezeigt.
- Nutzer:innen koennen:
  - Phase-Automation je Phase toggeln.
  - Zeitfenster/Thermometer (Start, Ende, Einheit, Bucket) anpassen (`business.phaseWindows.v1`).
  - Conditions ueberschreiben (`business.phaseConditions.v1`).
  - Custom-Phasen erzeugen/loeschen (`business.customPhases.v1`).
  - Templates erstellen/bearbeiten (gespeichert unter `business.templates.store.v1`).

## 8. Integrationen und Datenfluesse

### 8.1 REST-Endpunkte (NestJS, geplante Schnittstelle)

| Endpoint | Zweck |
| --- | --- |
| `GET /planning/stages/:stageId` | Liefert Ressourcen, Activities, Timeline, Versionsinfo. |
| `GET /planning/stages/:stageId/activities` | Gefilterte Activities. |
| `PUT /planning/stages/:stageId/activities` | Batch-Upserts/Deletes mit optionalem Optimistic Lock (`version`). |
| `POST /planning/stages/:stageId/activities:validate` | Fuehrt Validierungsregeln (Standort, Kapazitaet, Arbeitszeit, Quali, Custom) aus. |
| `GET /planning/stages/:stageId/events` | SSE-Stream fuer Echtzeit-Updates. |

Client-seitig wird `API_CONFIG` (siehe `src/app/core/config/api-config.ts`) fuer Basis-URL genutzt; ueberschreibbar via Meta-Tag oder `window.__ORDER_MGMT_API_BASE__`.

### 8.2 Event Payload-Empfehlung

```json
{
  "stageId": "base",
  "scope": "activities",
  "sourceClientId": "user-123",
  "sourceConnectionId": "tab-abc",
  "version": "2025-11-10T10:05:00.000Z",
  "upserts": [{ "...": "..." }],
  "deleteIds": ["..."]
}
```

Verbindungsabbrueche sollten automatisch rekonnetiert werden; bei Versionsdrift laedt der Client den kompletten Snapshot.

### 8.3 Lokale Persistenz und Storage

- Browser-Storage wird automatisch erkannt (`localStorage` wenn verfuegbar, sonst In-Memory).
- Wichtige Keys:
  - Auftragsfilter `orders.filters.v2`
  - Filter-Presets `orders.presets.v1`
  - Insights-Klappstatus `orders.insightsCollapsed.v1`
  - Template-/Phase-Konfiguration (siehe Abschnitt 7)
  - Automations-Protokoll (fluechtig in Signals gehalten)

## 9. Nichtfunktionale Anforderungen

- **Performance:** Listen sollen mit hunderten Positionen flussig scrollen (Virtualisierung ueber Angular CDK im Gantt, im Order-Bereich Response optimiert durch Signals und `effect`-Verb.
- **Interaktionsgeschwindigkeit:** Such-/Filtereingaben debouncen bei 200 ms; View-Transitions vermeiden harte Spruenge.
- **Fehlertoleranz:** Dialoge validieren Pflichtfelder (z. B. Kalenderdaten), Import-Tabs pruefen Filterkombinationen, Automationen pruefen Datenverfuegbarkeit (`targetDate` erforderlich).
- **Zugriff & Sicherheit:** Noch kein Auth-Mechanismus; spaeter JWT-Interceptor vorgesehen. Bis dahin muessen Mock-APIs lokal laufen.
- **Observability:** Snackbars bestaetigen Aktionen (Linking, Status, Submission). Automations-Logs halten Phase, Template-ID, Statusmeldung fest. Client sollte weitere Telemetrie-Hooks fuer Backend-Aufrufe bieten.
- **Internationalisierung:** UI ist deutschsprachig, dennoch ASCII-basierte Texte im Code. Labels fuer Phasen/Statuse muessen i18n-faehig gehalten werden (Konfiguration via Services/Maps).
- **Barrierefreiheit:** Buttons/Chips erhalten klare Icons + Labels; Selection-Mode muss per Tastatur erreichbar sein (Focus States, Space/Enter fuer Toggle).

## 10. Offene Punkte und Nacharbeiten

1. **Backend-Abgleich:** Mapping der Mock-Modelle (`Order`, `OrderItem`, `Business`) auf echte API-Schemas (OpenAPI `external_documents/openapi/planning-activities.yaml`) finalisieren.
2. **Validierungen:** Serverseitige Umsetzung der Rueckmeldungen (derzeit nur Interface vorhanden) fuer Order-spezifische Regeln (z. B. doppelte Tags, Fahrplanjahrverletzung).
3. **Rechtemodell:** Festlegen, welche Rollen Presets/Automationen aendern duerfen und wie Mandantenfaehigkeit (`clientId` der Activities) gespiegelt wird.
4. **Realtime-Backbone:** Strategie fuer Offline/Retry, Event-Batching und Konfliktaufloesung bei parallelen Order-Edits definieren.
5. **Tests:** Unit- und E2E-Tests fuer Order-Dialogs, Filter-Presets, Automation-Flows erweitern (derzeit fokussieren bestehende Tests auf Tick-Erzeugung im Gantt).
6. **Dokumentation:** Screenshots, Sequenzdiagramme und API-Beispiele fuer Order-spezifische Flows zusaetzlich im `docs/`-Verzeichnis hinterlegen.

Diese Markdown-Datei dient als Startpunkt und soll iterativ gepflegt werden, sobald neue Erkenntnisse oder Backend-Anforderungen hinzukommen.
