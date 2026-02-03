import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
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
  OperationalPointIdsRequest,
  OperationalPointBoundsRequest,
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
  TopologyRouteRequest,
} from './planning.types';

@Controller('planning/topology')
export class PlanningTopologyController {
  constructor(private readonly planningService: PlanningService) {}

  @Get('operational-points')
  listOperationalPoints() {
    return this.planningService.listOperationalPoints();
  }

  @Get('operational-points/paged')
  listOperationalPointsPaged(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('query') query?: string,
  ) {
    const paging = this.normalizePagingParams(offset, limit, query);
    return this.planningService.listOperationalPointsPaged(
      paging.offset,
      paging.limit,
      paging.query,
    );
  }

  @Get('operational-points/bbox')
  listOperationalPointsInBounds(
    @Query('minLat') minLat?: string,
    @Query('minLng') minLng?: string,
    @Query('maxLat') maxLat?: string,
    @Query('maxLng') maxLng?: string,
    @Query('limit') limit?: string,
  ) {
    const request = this.normalizeBoundsParams({
      minLat,
      minLng,
      maxLat,
      maxLng,
      limit,
    });
    return this.planningService.listOperationalPointsInBounds(request);
  }

  @Put('operational-points')
  saveOperationalPoints(@Body() request: OperationalPointListRequest) {
    return this.planningService.saveOperationalPoints(request);
  }

  @Post('operational-points/by-ids')
  listOperationalPointsByIds(@Body() request: OperationalPointIdsRequest) {
    const ids = Array.isArray(request?.ids) ? request.ids : [];
    return this.planningService.listOperationalPointsByIds(ids);
  }

  @Get('sections-of-line')
  listSectionsOfLine() {
    return this.planningService.listSectionsOfLine();
  }

  @Get('sections-of-line/paged')
  listSectionsOfLinePaged(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('query') query?: string,
  ) {
    const paging = this.normalizePagingParams(offset, limit, query);
    return this.planningService.listSectionsOfLinePaged(
      paging.offset,
      paging.limit,
      paging.query,
    );
  }

  @Put('sections-of-line')
  saveSectionsOfLine(@Body() request: SectionOfLineListRequest) {
    return this.planningService.saveSectionsOfLine(request);
  }

  @Post('route')
  planRoute(@Body() request: TopologyRouteRequest) {
    return this.planningService.planTopologyRoute(request);
  }

  @Get('station-areas')
  listStationAreas() {
    return this.planningService.listStationAreas();
  }

  @Get('station-areas/paged')
  listStationAreasPaged(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('query') query?: string,
  ) {
    const paging = this.normalizePagingParams(offset, limit, query);
    return this.planningService.listStationAreasPaged(
      paging.offset,
      paging.limit,
      paging.query,
    );
  }

  @Put('station-areas')
  saveStationAreas(@Body() request: StationAreaListRequest) {
    return this.planningService.saveStationAreas(request);
  }

  @Get('tracks')
  listTracks() {
    return this.planningService.listTracks();
  }

  @Get('tracks/paged')
  listTracksPaged(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('query') query?: string,
  ) {
    const paging = this.normalizePagingParams(offset, limit, query);
    return this.planningService.listTracksPaged(
      paging.offset,
      paging.limit,
      paging.query,
    );
  }

  @Put('tracks')
  saveTracks(@Body() request: TrackListRequest) {
    return this.planningService.saveTracks(request);
  }

  @Get('platform-edges')
  listPlatformEdges() {
    return this.planningService.listPlatformEdges();
  }

  @Get('platform-edges/paged')
  listPlatformEdgesPaged(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('query') query?: string,
  ) {
    const paging = this.normalizePagingParams(offset, limit, query);
    return this.planningService.listPlatformEdgesPaged(
      paging.offset,
      paging.limit,
      paging.query,
    );
  }

  @Put('platform-edges')
  savePlatformEdges(@Body() request: PlatformEdgeListRequest) {
    return this.planningService.savePlatformEdges(request);
  }

  @Get('platforms')
  listPlatforms() {
    return this.planningService.listPlatforms();
  }

  @Get('platforms/paged')
  listPlatformsPaged(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('query') query?: string,
  ) {
    const paging = this.normalizePagingParams(offset, limit, query);
    return this.planningService.listPlatformsPaged(
      paging.offset,
      paging.limit,
      paging.query,
    );
  }

  @Put('platforms')
  savePlatforms(@Body() request: PlatformListRequest) {
    return this.planningService.savePlatforms(request);
  }

  @Get('sidings')
  listSidings() {
    return this.planningService.listSidings();
  }

  @Get('sidings/paged')
  listSidingsPaged(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('query') query?: string,
  ) {
    const paging = this.normalizePagingParams(offset, limit, query);
    return this.planningService.listSidingsPaged(
      paging.offset,
      paging.limit,
      paging.query,
    );
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

  private normalizePagingParams(
    offsetParam?: string,
    limitParam?: string,
    queryParam?: string,
  ) {
    const offsetCandidate = Number.parseInt(offsetParam ?? '0', 10);
    const limitCandidate = Number.parseInt(limitParam ?? '500', 10);
    const offset = Number.isFinite(offsetCandidate) ? Math.max(0, offsetCandidate) : 0;
    const limit = Number.isFinite(limitCandidate)
      ? Math.min(Math.max(1, limitCandidate), 5000)
      : 500;
    const query = (queryParam ?? '').trim();
    return {
      offset,
      limit,
      query: query.length > 0 ? query : null,
    };
  }

  private normalizeBoundsParams(params: {
    minLat?: string;
    minLng?: string;
    maxLat?: string;
    maxLng?: string;
    limit?: string;
  }): OperationalPointBoundsRequest {
    const toNumber = (value?: string) => {
      if (value === undefined || value === null || value === '') {
        return Number.NaN;
      }
      return Number(value);
    };
    const minLat = toNumber(params.minLat);
    const minLng = toNumber(params.minLng);
    const maxLat = toNumber(params.maxLat);
    const maxLng = toNumber(params.maxLng);
    if (![minLat, minLng, maxLat, maxLng].every((val) => Number.isFinite(val))) {
      throw new BadRequestException('Bounding box parameters are required.');
    }
    const parsedLimit = Number(params.limit);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(5000, parsedLimit))
      : 2000;
    return {
      minLat: Math.min(minLat, maxLat),
      minLng: Math.min(minLng, maxLng),
      maxLat: Math.max(minLat, maxLat),
      maxLng: Math.max(minLng, maxLng),
      limit,
    };
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
