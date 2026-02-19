import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TimetableOrderingService } from './timetable-ordering.service';
import type {
  ApplyTimetableOrderingActionPayload,
  ApplyTimetableOrderingEventPayload,
  ApplyTimetableOrderingSimulatorPayload,
  CreateTimetableOrderingCasePayload,
} from './timetable-ordering.types';

@Controller('timetable-ordering')
export class TimetableOrderingController {
  constructor(private readonly service: TimetableOrderingService) {}

  @Get('profiles')
  listProfiles() {
    return this.service.listProfiles();
  }

  @Get('cases')
  listCases() {
    return this.service.listCases();
  }

  @Post('cases')
  createCase(@Body() payload: CreateTimetableOrderingCasePayload) {
    return this.service.createCase(payload);
  }

  @Get('cases/:caseId')
  getCase(@Param('caseId') caseId: string) {
    return this.service.getCaseDetails(caseId);
  }

  @Get('cases/:caseId/snapshot')
  getSnapshot(@Param('caseId') caseId: string) {
    return this.service.getSnapshot(caseId);
  }

  @Post('cases/:caseId/actions')
  applyAction(
    @Param('caseId') caseId: string,
    @Body() payload: ApplyTimetableOrderingActionPayload,
  ) {
    return this.service.applyAction(caseId, payload);
  }

  @Post('cases/:caseId/events')
  applyEvent(
    @Param('caseId') caseId: string,
    @Body() payload: ApplyTimetableOrderingEventPayload,
  ) {
    return this.service.applyInboundEvent(caseId, payload);
  }

  @Post('cases/:caseId/simulator')
  applySimulator(
    @Param('caseId') caseId: string,
    @Body() payload: ApplyTimetableOrderingSimulatorPayload,
  ) {
    return this.service.applySimulatorResponse(caseId, payload);
  }
}
