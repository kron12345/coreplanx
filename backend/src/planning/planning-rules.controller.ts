import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { PlanningRuleMutationRequest } from './planning.types';
import { PlanningRuleService } from './planning-rule.service';
import {
  deriveTimetableYearLabelFromVariantId,
  normalizeVariantId,
} from '../shared/variant-scope';
import { isStageId } from './planning.types';

@Controller('planning/stages')
export class PlanningRulesController {
  constructor(private readonly rules: PlanningRuleService) {}

  @Get(':stageId/rules')
  async listRules(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
  ) {
    if (!isStageId(stageId)) {
      throw new BadRequestException(`Stage ${stageId} ist unbekannt.`);
    }
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    const items = await this.rules.listRules(stageId, normalizedVariantId);
    return { items };
  }

  @Put(':stageId/rules')
  async mutateRules(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() request?: PlanningRuleMutationRequest,
  ) {
    if (!isStageId(stageId)) {
      throw new BadRequestException(`Stage ${stageId} ist unbekannt.`);
    }
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.rules.mutateRules(stageId, normalizedVariantId, request ?? undefined);
  }

  @Post(':stageId/rules/reset')
  async resetRulesToDefaults(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
  ) {
    if (!isStageId(stageId)) {
      throw new BadRequestException(`Stage ${stageId} ist unbekannt.`);
    }
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    const items = await this.rules.resetRulesToDefaults(stageId, normalizedVariantId);
    return { items };
  }
}
