import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const scheduleTemplateSelect = {
  id: true,
  title: true,
  description: true,
  trainNumber: true,
  responsibleRu: true,
  status: true,
  category: true,
  tags: true,
  validityStart: true,
  validityEnd: true,
  recurrence: true,
  composition: true,
  createdAt: true,
  updatedAt: true,
  stops: {
    select: {
      id: true,
      sequence: true,
      type: true,
      locationCode: true,
      locationName: true,
      countryCode: true,
      arrivalEarliest: true,
      arrivalLatest: true,
      departureEarliest: true,
      departureLatest: true,
      offsetDays: true,
      dwellMinutes: true,
      activities: true,
      platformWish: true,
      notes: true,
    },
    orderBy: { sequence: 'asc' },
  },
} satisfies Prisma.ScheduleTemplateSelect;

export type ScheduleTemplateRecord = Prisma.ScheduleTemplateGetPayload<{
  select: typeof scheduleTemplateSelect;
}>;

@Injectable()
export class ScheduleTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  listTemplates(): Promise<ScheduleTemplateRecord[]> {
    return this.prisma.scheduleTemplate.findMany({
      select: scheduleTemplateSelect,
      orderBy: { updatedAt: 'desc' },
    });
  }

  getTemplateById(id: string): Promise<ScheduleTemplateRecord | null> {
    return this.prisma.scheduleTemplate.findUnique({
      where: { id },
      select: scheduleTemplateSelect,
    });
  }

  async createTemplate(
    template: Prisma.ScheduleTemplateCreateInput,
    stops: Prisma.ScheduleTemplateStopCreateWithoutTemplateInput[],
  ): Promise<ScheduleTemplateRecord> {
    await this.prisma.scheduleTemplate.create({
      data: {
        ...template,
        stops: {
          create: stops,
        },
      },
    });
    const created = await this.getTemplateById(template.id as string);
    if (!created) {
      throw new Error('Created schedule template not found.');
    }
    return created;
  }

  async updateTemplate(
    templateId: string,
    data: Prisma.ScheduleTemplateUpdateInput,
    stops?: Prisma.ScheduleTemplateStopCreateManyInput[],
  ): Promise<ScheduleTemplateRecord | null> {
    let updated = false;
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.scheduleTemplate.updateMany({
        where: { id: templateId },
        data,
      });
      if (!result.count) {
        return;
      }
      updated = true;
      if (stops) {
        await tx.scheduleTemplateStop.deleteMany({
          where: { templateId },
        });
        if (stops.length) {
          await tx.scheduleTemplateStop.createMany({
            data: stops,
          });
        }
      }
    });
    return updated ? this.getTemplateById(templateId) : null;
  }

  async deleteTemplate(templateId: string): Promise<boolean> {
    const result = await this.prisma.scheduleTemplate.deleteMany({
      where: { id: templateId },
    });
    return result.count > 0;
  }
}
