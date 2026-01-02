import { BadRequestException, Body, Controller, Param, Post, Query } from '@nestjs/common';
import { PlanningOptimizationService } from './planning-optimization.service';
import type { RulesetSelectionInput } from './planning-optimization.service';
import { deriveTimetableYearLabelFromVariantId, normalizeVariantId } from '../shared/variant-scope';
import { isStageId } from './planning.types';

@Controller('planning/stages')
export class PlanningOptimizationController {
  constructor(private readonly optimizer: PlanningOptimizationService) {}

  @Post(':stageId/autopilot/preview')
  async previewAutopilot(
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
    return this.optimizer.previewAutopilot(
      stageId,
      normalizedVariantId,
      derivedYear ?? timetableYearLabel ?? null,
    );
  }

  @Post(':stageId/optimizer/candidates')
  async buildCandidates(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() payload?: RulesetSelectionInput,
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
    return this.optimizer.buildCandidates(
      stageId,
      normalizedVariantId,
      derivedYear ?? timetableYearLabel ?? null,
      payload,
    );
  }

  @Post(':stageId/optimizer/solve')
  async solve(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() payload?: RulesetSelectionInput,
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
    return this.optimizer.solve(
      stageId,
      normalizedVariantId,
      derivedYear ?? timetableYearLabel ?? null,
      payload,
    );
  }
}
