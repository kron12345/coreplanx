import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { map } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import { PlanningService } from './planning.service';
import type {
  OperationalPointListRequest,
  SectionOfLineListRequest,
  StationAreaListRequest,
  TrackListRequest,
  PlatformEdgeListRequest,
  PlatformListRequest,
  SidingListRequest,
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

  @Get('station-areas')
  listStationAreas() {
    return this.planningService.listStationAreas();
  }

  @Put('station-areas')
  saveStationAreas(@Body() request: StationAreaListRequest) {
    return this.planningService.saveStationAreas(request);
  }

  @Get('tracks')
  listTracks() {
    return this.planningService.listTracks();
  }

  @Put('tracks')
  saveTracks(@Body() request: TrackListRequest) {
    return this.planningService.saveTracks(request);
  }

  @Get('platform-edges')
  listPlatformEdges() {
    return this.planningService.listPlatformEdges();
  }

  @Put('platform-edges')
  savePlatformEdges(@Body() request: PlatformEdgeListRequest) {
    return this.planningService.savePlatformEdges(request);
  }

  @Get('platforms')
  listPlatforms() {
    return this.planningService.listPlatforms();
  }

  @Put('platforms')
  savePlatforms(@Body() request: PlatformListRequest) {
    return this.planningService.savePlatforms(request);
  }

  @Get('sidings')
  listSidings() {
    return this.planningService.listSidings();
  }

  @Put('sidings')
  saveSidings(@Body() request: SidingListRequest) {
    return this.planningService.saveSidings(request);
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

  @Sse('import/events')
  streamImportEvents(): Observable<MessageEvent> {
    return this.planningService.streamTopologyImportEvents().pipe(
      map((event) => ({ data: event })),
    );
  }

  @Post('import/upload')
  async uploadImportFile(@Req() request: FastifyRequest) {
    if (!request.isMultipart?.()) {
      throw new BadRequestException('Ungültiger Upload: multipart/form-data erwartet.');
    }
    const data = await request.file();
    if (!data) {
      throw new BadRequestException('Keine Importdatei übergeben.');
    }
    const kind = this.extractMultipartField(data.fields, 'kind');
    if (!kind) {
      throw new BadRequestException('Importtyp fehlt (kind).');
    }
    const buffer = await data.toBuffer();
    return this.planningService.uploadTopologyImportFile(
      {
        originalname: data.filename,
        buffer,
      },
      kind,
    );
  }

  @Post('import/events')
  publishImportEvent(@Body() request: TopologyImportEventRequest) {
    return this.planningService.publishTopologyImportEvent(request);
  }

  @Post('reset')
  async resetToDefaults() {
    await this.planningService.resetTopologyToDefaults();
    return { ok: true };
  }

  private extractMultipartField(
    fields: Record<string, unknown> | undefined,
    name: string,
  ): string {
    const entry = fields?.[name];
    if (!entry) {
      return '';
    }
    const value = Array.isArray(entry) ? entry.find((item) => item.type === 'field') : entry;
    if (value && value.type === 'field') {
      return typeof value.value === 'string' ? value.value : String(value.value ?? '');
    }
    return '';
  }
}
