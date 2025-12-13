import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MATERIAL_IMPORTS } from '../core/material.imports.imports';
import { PlanningStoreService } from '../shared/planning-store.service';
import { OperationalPointEditorComponent } from './components/operational-point-editor.component';
import { SectionOfLineEditorComponent } from './components/section-of-line-editor.component';
import { PersonnelSiteEditorComponent } from './components/personnel-site-editor.component';
import { ReplacementStopEditorComponent } from './components/replacement-stop-editor.component';
import { ReplacementRouteEditorComponent } from './components/replacement-route-editor.component';
import { ReplacementEdgeEditorComponent } from './components/replacement-edge-editor.component';
import { OpReplacementStopLinkEditorComponent } from './components/op-replacement-stop-link-editor.component';
import { TransferEdgeEditorComponent } from './components/transfer-edge-editor.component';

@Component({
    selector: 'app-planning-master',
    imports: [
        CommonModule,
        MatTabsModule,
        OperationalPointEditorComponent,
        SectionOfLineEditorComponent,
        PersonnelSiteEditorComponent,
        ReplacementStopEditorComponent,
        ReplacementRouteEditorComponent,
        ReplacementEdgeEditorComponent,
        OpReplacementStopLinkEditorComponent,
        TransferEdgeEditorComponent,
        ...MATERIAL_IMPORTS,
    ],
    templateUrl: './planning-master.component.html',
    styleUrl: './planning-master.component.scss',
})
export class PlanningMasterComponent implements OnInit {
  private readonly store = inject(PlanningStoreService);

  ngOnInit(): void {
    this.store.ensureInitialized();
  }
}
