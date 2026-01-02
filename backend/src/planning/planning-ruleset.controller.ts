import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PlanningRulesetService } from './planning-ruleset.service';
import type { RulesetDocument } from './planning-ruleset.types';

@Controller('planning/rulesets')
export class PlanningRulesetController {
  constructor(private readonly rulesets: PlanningRulesetService) {}

  @Get()
  listRulesets() {
    return { items: this.rulesets.listRulesets() };
  }

  @Get(':rulesetId/versions')
  listVersions(@Param('rulesetId') rulesetId: string) {
    return { rulesetId, versions: this.rulesets.listVersions(rulesetId) };
  }

  @Get(':rulesetId/:version')
  getRuleset(@Param('rulesetId') rulesetId: string, @Param('version') version: string) {
    return this.rulesets.getRuleset(rulesetId, version);
  }

  @Get(':rulesetId/:version/ir')
  getRulesetIr(@Param('rulesetId') rulesetId: string, @Param('version') version: string) {
    return this.rulesets.getCompiledRuleset(rulesetId, version);
  }

  @Post('validate')
  validateRuleset(@Body() payload: unknown) {
    const doc = this.rulesets.parseRulesetPayload(payload);
    return this.rulesets.validateRuleset(doc);
  }

  @Post('preview')
  previewRuleset(
    @Body() payload: unknown,
    @Query('resolveIncludes') resolveIncludes?: string,
  ) {
    const doc = this.rulesets.parseRulesetPayload(payload);
    const shouldResolve = resolveIncludes ? resolveIncludes !== 'false' : true;
    return this.rulesets.previewRuleset(doc, shouldResolve);
  }
}
