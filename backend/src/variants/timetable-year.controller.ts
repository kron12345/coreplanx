import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TimetableYearService } from './timetable-year.service';

@Controller('timetable-years')
export class TimetableYearController {
  constructor(private readonly service: TimetableYearService) {}

  @Get()
  listYears(): Promise<string[]> {
    return this.service.listYears();
  }

  @Get('variants')
  listVariants(@Query('timetableYearLabel') timetableYearLabel?: string) {
    return this.service.listVariants(timetableYearLabel);
  }

  @Post('variants')
  createSimulationVariant(
    @Body()
    payload: {
      timetableYearLabel?: string;
      label?: string;
      description?: string | null;
    },
  ) {
    const timetableYearLabel = payload?.timetableYearLabel?.trim();
    const label = payload?.label?.trim();
    if (!timetableYearLabel) {
      throw new BadRequestException(
        'timetableYearLabel ist erforderlich (z. B. 2025/26).',
      );
    }
    if (!label) {
      throw new BadRequestException('label ist erforderlich.');
    }
    return this.service.createSimulationVariant({
      timetableYearLabel,
      label,
      description: payload?.description ?? null,
    });
  }

  @Put('variants/:variantId')
  updateSimulationVariant(
    @Param('variantId') variantId: string,
    @Body() payload: { label?: string; description?: string | null },
  ) {
    const label = payload?.label?.trim();
    if (label !== undefined && label.length === 0) {
      throw new BadRequestException('label darf nicht leer sein.');
    }
    return this.service.updateSimulationVariant(variantId, {
      label: payload?.label,
      description: payload?.description ?? null,
    });
  }

  @Delete('variants/:variantId')
  deleteVariant(@Param('variantId') variantId: string) {
    const trimmed = variantId?.trim();
    if (!trimmed) {
      throw new BadRequestException('variantId ist erforderlich.');
    }
    return this.service.deleteVariant(trimmed);
  }

  @Post()
  createYear(@Body() payload: { label?: string }) {
    const label = payload?.label?.trim();
    if (!label) {
      throw new BadRequestException('label ist erforderlich (z. B. 2025/26).');
    }
    return this.service.createYear(label);
  }

  @Delete()
  deleteYear(@Query('label') label?: string) {
    const trimmed = label?.trim();
    if (!trimmed) {
      throw new BadRequestException(
        'Query param "label" ist erforderlich (z. B. 2025/26).',
      );
    }
    return this.service.deleteYear(trimmed);
  }
}
