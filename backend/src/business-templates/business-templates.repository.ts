import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const businessTemplateSelect = {
  id: true,
  title: true,
  description: true,
  instructions: true,
  tags: true,
  category: true,
  recommendedAssignmentType: true,
  recommendedAssignmentName: true,
  dueRuleAnchor: true,
  dueRuleOffsetDays: true,
  dueRuleLabel: true,
  defaultLeadTimeDays: true,
  automationHint: true,
  steps: true,
  parameterHints: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BusinessTemplateSelect;

export type BusinessTemplateRecord = Prisma.BusinessTemplateGetPayload<{
  select: typeof businessTemplateSelect;
}>;

@Injectable()
export class BusinessTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  listTemplates(): Promise<BusinessTemplateRecord[]> {
    return this.prisma.businessTemplate.findMany({
      select: businessTemplateSelect,
      orderBy: { updatedAt: 'desc' },
    });
  }

  getTemplateById(id: string): Promise<BusinessTemplateRecord | null> {
    return this.prisma.businessTemplate.findUnique({
      where: { id },
      select: businessTemplateSelect,
    });
  }

  async createTemplate(
    template: Prisma.BusinessTemplateCreateInput,
  ): Promise<BusinessTemplateRecord> {
    await this.prisma.businessTemplate.create({ data: template });
    const created = await this.getTemplateById(template.id as string);
    if (!created) {
      throw new Error('Created business template not found.');
    }
    return created;
  }

  async updateTemplate(
    templateId: string,
    data: Prisma.BusinessTemplateUpdateInput,
  ): Promise<BusinessTemplateRecord | null> {
    const result = await this.prisma.businessTemplate.updateMany({
      where: { id: templateId },
      data,
    });
    if (!result.count) {
      return null;
    }
    return this.getTemplateById(templateId);
  }

  async deleteTemplate(templateId: string): Promise<boolean> {
    const result = await this.prisma.businessTemplate.deleteMany({
      where: { id: templateId },
    });
    return result.count > 0;
  }
}
