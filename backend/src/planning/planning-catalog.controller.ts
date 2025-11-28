import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type {
  ActivityCatalogSnapshot,
  ActivityDefinition,
  ActivityTemplate,
  ActivityTypeDefinition,
  LayerGroup,
  TranslationState,
} from './planning.types';
import { PlanningService } from './planning.service';

@Controller('planning/catalog')
export class PlanningCatalogController {
  constructor(private readonly planningService: PlanningService) {}

  @Get()
  getCatalog() {
    return this.planningService.getActivityCatalog();
  }

  @Put()
  replaceCatalog(@Body() payload: ActivityCatalogSnapshot) {
    return this.planningService.replaceActivityCatalog(payload);
  }

  @Get('types')
  listTypes() {
    return this.planningService.listActivityTypes();
  }

  @Post('types')
  createType(@Body() payload: ActivityTypeDefinition) {
    return this.planningService.createActivityType(payload);
  }

  @Get('types/:typeId')
  getType(@Param('typeId') typeId: string) {
    return this.planningService.getActivityType(typeId);
  }

  @Put('types/:typeId')
  upsertType(
    @Param('typeId') typeId: string,
    @Body() payload: ActivityTypeDefinition,
  ) {
    return this.planningService.upsertActivityType(typeId, payload);
  }

  @Delete('types/:typeId')
  @HttpCode(204)
  deleteType(@Param('typeId') typeId: string) {
    return this.planningService.deleteActivityType(typeId);
  }

  @Get('templates')
  listTemplates() {
    return this.planningService.listActivityTemplates();
  }

  @Post('templates')
  createTemplate(@Body() payload: ActivityTemplate) {
    return this.planningService.createActivityTemplate(payload);
  }

  @Get('templates/:templateId')
  getTemplate(@Param('templateId') templateId: string) {
    return this.planningService.getActivityTemplate(templateId);
  }

  @Put('templates/:templateId')
  upsertTemplate(
    @Param('templateId') templateId: string,
    @Body() payload: ActivityTemplate,
  ) {
    return this.planningService.upsertActivityTemplate(templateId, payload);
  }

  @Delete('templates/:templateId')
  @HttpCode(204)
  deleteTemplate(@Param('templateId') templateId: string) {
    return this.planningService.deleteActivityTemplate(templateId);
  }

  @Get('definitions')
  listDefinitions() {
    return this.planningService.listActivityDefinitions();
  }

  @Post('definitions')
  createDefinition(@Body() payload: ActivityDefinition) {
    return this.planningService.createActivityDefinition(payload);
  }

  @Get('definitions/:definitionId')
  getDefinition(@Param('definitionId') definitionId: string) {
    return this.planningService.getActivityDefinition(definitionId);
  }

  @Put('definitions/:definitionId')
  upsertDefinition(
    @Param('definitionId') definitionId: string,
    @Body() payload: ActivityDefinition,
  ) {
    return this.planningService.upsertActivityDefinition(definitionId, payload);
  }

  @Delete('definitions/:definitionId')
  @HttpCode(204)
  deleteDefinition(@Param('definitionId') definitionId: string) {
    return this.planningService.deleteActivityDefinition(definitionId);
  }

  @Get('layers')
  listLayerGroups() {
    return this.planningService.listLayerGroups();
  }

  @Post('layers')
  createLayerGroup(@Body() payload: LayerGroup) {
    return this.planningService.createLayerGroup(payload);
  }

  @Get('layers/:layerId')
  getLayerGroup(@Param('layerId') layerId: string) {
    return this.planningService.getLayerGroup(layerId);
  }

  @Put('layers/:layerId')
  upsertLayerGroup(
    @Param('layerId') layerId: string,
    @Body() payload: LayerGroup,
  ) {
    return this.planningService.upsertLayerGroup(layerId, payload);
  }

  @Delete('layers/:layerId')
  @HttpCode(204)
  deleteLayerGroup(@Param('layerId') layerId: string) {
    return this.planningService.deleteLayerGroup(layerId);
  }

  @Get('translations')
  getTranslations() {
    return this.planningService.getTranslations();
  }

  @Put('translations')
  replaceTranslations(@Body() payload: TranslationState) {
    return this.planningService.replaceTranslations(payload);
  }

  @Get('translations/:locale')
  getTranslationsForLocale(@Param('locale') locale: string) {
    return this.planningService.getTranslationsForLocale(locale);
  }

  @Put('translations/:locale')
  replaceTranslationsForLocale(
    @Param('locale') locale: string,
    @Body()
    payload: Record<
      string,
      { label?: string | null; abbreviation?: string | null }
    >,
  ) {
    return this.planningService.replaceTranslationsForLocale(locale, payload);
  }

  @Delete('translations/:locale')
  @HttpCode(204)
  deleteTranslationsForLocale(@Param('locale') locale: string) {
    return this.planningService.deleteTranslationsForLocale(locale);
  }
}
