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
  standalone: true,
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
  template: `
    <div class="planning-master">
      <mat-tab-group color="primary">
        <mat-tab label="Operational Points">
          <app-operational-point-editor />
        </mat-tab>
        <mat-tab label="Sections of Line">
          <app-section-of-line-editor />
        </mat-tab>
        <mat-tab label="Personnel Sites">
          <app-personnel-site-editor />
        </mat-tab>
        <mat-tab label="Replacement Stops">
          <app-replacement-stop-editor />
        </mat-tab>
        <mat-tab label="Replacement Routes">
          <app-replacement-route-editor />
        </mat-tab>
        <mat-tab label="Replacement Edges">
          <app-replacement-edge-editor />
        </mat-tab>
        <mat-tab label="OP ↔ Replacement Links">
          <app-op-replacement-stop-link-editor />
        </mat-tab>
        <mat-tab label="Transfer Edges">
          <app-transfer-edge-editor />
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [
    `
      .planning-master {
        display: block;
        padding: 16px;
      }

      mat-tab-group {
        background: var(--mdc-filled-text-field-container-color, #fff);
        border-radius: 12px;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.05),
          0 6px 16px rgba(0, 0, 0, 0.06);
      }
    `,
  ],
})
export class PlanningMasterComponent implements OnInit {
  private readonly store = inject(PlanningStoreService);

  ngOnInit(): void {
    this.store.ensureInitialized();
  }
}
