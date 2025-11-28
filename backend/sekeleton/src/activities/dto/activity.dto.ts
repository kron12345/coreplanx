import { ApiProperty } from '@nestjs/swagger';

export class ResourceAssignmentDto {
  @ApiProperty()
  resourceId!: string;
  @ApiProperty()
  resourceType!: string;
  @ApiProperty({ required: false })
  role?: string;
  @ApiProperty({ required: false })
  lineIndex?: number;
}

export class ActivityDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  type!: string;
  @ApiProperty()
  label!: string;
  @ApiProperty()
  start!: string;
  @ApiProperty({ required: false, nullable: true })
  end!: string | null;
  @ApiProperty()
  status!: string;
  @ApiProperty({ type: Object })
  attributes!: Record<string, unknown>;
  @ApiProperty({ type: [ResourceAssignmentDto] })
  resourceAssignments!: ResourceAssignmentDto[];
}
