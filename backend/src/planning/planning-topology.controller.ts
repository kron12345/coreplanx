import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Post,
  Put,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PlanningService } from './planning.service';
import type {
  OperationalPointListRequest,
  SectionOfLineListRequest,
  PersonnelSiteListRequest,
  ReplacementStopListRequest,
  ReplacementRouteListRequest,
  ReplacementEdgeListRequest,
  OpReplacementStopLinkListRequest,
  TransferEdgeListRequest,
  TopologyImportRequest,
  TopologyImportEventRequest,
} from './planning.types';

@Controller('planning/topology')
export class PlanningTopologyController {
  constructor(private readonly planningService: PlanningService) {}

  @Get('operational-points')
  listOperationalPoints() {
    return this.planningService.listOperationalPoints();
  }

  @Put('operational-points')
  saveOperationalPoints(@Body() request: OperationalPointListRequest) {
    return this.planningService.saveOperationalPoints(request);
  }

  @Get('sections-of-line')
  listSectionsOfLine() {
    return this.planningService.listSectionsOfLine();
  }

  @Put('sections-of-line')
  saveSectionsOfLine(@Body() request: SectionOfLineListRequest) {
    return this.planningService.saveSectionsOfLine(request);
  }

  @Get('personnel-sites')
  listPersonnelSites() {
    return this.planningService.listPersonnelSites();
  }

  @Put('personnel-sites')
  savePersonnelSites(@Body() request: PersonnelSiteListRequest) {
    return this.planningService.savePersonnelSites(request);
  }

  @Get('replacement-stops')
  listReplacementStops() {
    return this.planningService.listReplacementStops();
  }

  @Put('replacement-stops')
  saveReplacementStops(@Body() request: ReplacementStopListRequest) {
    return this.planningService.saveReplacementStops(request);
  }

  @Get('replacement-routes')
  listReplacementRoutes() {
    return this.planningService.listReplacementRoutes();
  }

  @Put('replacement-routes')
  saveReplacementRoutes(@Body() request: ReplacementRouteListRequest) {
    return this.planningService.saveReplacementRoutes(request);
  }

  @Get('replacement-edges')
  listReplacementEdges() {
    return this.planningService.listReplacementEdges();
  }

  @Put('replacement-edges')
  saveReplacementEdges(@Body() request: ReplacementEdgeListRequest) {
    return this.planningService.saveReplacementEdges(request);
  }

  @Get('op-replacement-stop-links')
  listOpReplacementStopLinks() {
    return this.planningService.listOpReplacementStopLinks();
  }

  @Put('op-replacement-stop-links')
  saveOpReplacementStopLinks(
    @Body() request: OpReplacementStopLinkListRequest,
  ) {
    return this.planningService.saveOpReplacementStopLinks(request);
  }

  @Get('op-replacement-links')
  listOpReplacementLinksAlias() {
    return this.planningService.listOpReplacementStopLinks();
  }

  @Put('op-replacement-links')
  saveOpReplacementLinksAlias(
    @Body() request: OpReplacementStopLinkListRequest,
  ) {
    return this.planningService.saveOpReplacementStopLinks(request);
  }

  @Get('transfer-edges')
  listTransferEdges() {
    return this.planningService.listTransferEdges();
  }

  @Put('transfer-edges')
  saveTransferEdges(@Body() request: TransferEdgeListRequest) {
    return this.planningService.saveTransferEdges(request);
  }

  @Post('import')
  triggerImport(@Body() request?: TopologyImportRequest) {
    return this.planningService.triggerTopologyImport(request);
  }

  @Post('import/events')
  publishImportEvent(@Body() request: TopologyImportEventRequest) {
    return this.planningService.publishTopologyImportEvent(request);
  }

  @Sse('import/events')
  streamImportEvents(): Observable<MessageEvent> {
    return this.planningService
      .streamTopologyImportEvents()
      .pipe(map((event) => ({ data: event })));
  }
}
