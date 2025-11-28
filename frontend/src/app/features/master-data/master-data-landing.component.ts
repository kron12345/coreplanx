import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MasterDataLayoutComponent } from './components/master-data-layout/master-data-layout.component';
import { MasterDataTabConfig } from './master-data.types';
import { PlanningMasterComponent } from '../../planning/planning-master.component';
import { PersonnelMasterEditorComponent } from './components/personnel-master-editor/personnel-master-editor.component';
import { VehicleMasterEditorComponent } from './components/vehicle-master-editor/vehicle-master-editor.component';
import { TimetableYearMasterEditorComponent } from './components/timetable-year-master-editor/timetable-year-master-editor.component';

@Component({
  selector: 'app-master-data-landing',
  standalone: true,
  imports: [CommonModule, MasterDataLayoutComponent],
  templateUrl: './master-data-landing.component.html',
  styleUrl: './master-data-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MasterDataLandingComponent {

  protected readonly title = 'Stammdatenpflege';
  protected readonly subtitle =
    'Verwalten Sie Personal- und Fahrzeugstammdaten zentral. Alle Kategorien folgen demselben Bedienkonzept.';


  protected readonly tabs = computed<MasterDataTabConfig[]>(() => this.buildTabs());

  private buildTabs(): MasterDataTabConfig[] {
    return [
      {
        id: 'personnel',
        icon: 'badge',
        title: 'Personal',
        description:
          'Dienste und Mitarbeitende werden hierarchisch nach Pools organisiert – zuerst den Pool anlegen, dann die zugehörigen Ressourcen pflegen.',
        sections: [
          {
            type: 'component',
            id: 'personnel-attribute-editor',
            title: 'Attribut-Editor (Beta)',
            description: 'Zwischen Dienst- und Personalpools wechseln und Attribute flexibel pflegen.',
            component: PersonnelMasterEditorComponent,
          },
        ],
      },
      {
        id: 'timetable-years',
        icon: 'event',
        title: 'Fahrplanjahre',
        description:
          'Definiere hier die gültigen Fahrplanjahre. Alle Auftrags- und Kalenderdialoge greifen auf diese Liste zurück.',
        sections: [
          {
            type: 'component',
            id: 'timetable-year-editor',
            title: 'Fahrplanjahre',
            description:
              'Start- und Enddatum sind inklusive. Über die Beschreibung kannst du z. B. Quelle oder Besonderheiten dokumentieren.',
            component: TimetableYearMasterEditorComponent,
          },
        ],
      },
      {
        id: 'vehicles',
        icon: 'directions_transit',
        title: 'Fahrzeuge',
        description:
          'Alle Fahrzeugdaten – Dienste, Pools, Fahrzeuge, Typen und Kompositionen – in einer konsistenten Ansicht pflegen.',
        sections: [
          {
            type: 'component',
            id: 'vehicle-master-editor',
            title: 'Fahrzeug-Editor',
            description: 'Zwischen Diensten, Pools, Fahrzeugen, Typen und Kompositionen wechseln – ein Editor für alles.',
            component: VehicleMasterEditorComponent,
          },
        ],
      },
      {
        id: 'topology',
        icon: 'share_location',
        title: 'Topologie',
        description:
          'Planungs-Masterdaten wie Betriebsstellen, Strecken und Ersatzverkehre zentral pflegen.',
        sections: [
          {
            type: 'component',
            id: 'planning-topology',
            title: 'Planungs-Masterdaten',
            description:
              'Der Topologie-Editor bündelt alle Netz- und Ersatzverkehrsstrukturen für die Planung.',
            component: PlanningMasterComponent,
          },
        ],
      },
    ];
  }

}
