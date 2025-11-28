import { ApiProperty } from '@nestjs/swagger';

export class ServiceDto {
  @ApiProperty()
  id!: string;
  @ApiProperty({ enum: ['SERVICE', 'ABSENCE'] })
  type!: 'SERVICE' | 'ABSENCE';
  @ApiProperty()
  resourceId!: string;
  @ApiProperty()
  start!: string;
  @ApiProperty({ nullable: true })
  end!: string | null;
  @ApiProperty()
  label!: string;
  @ApiProperty()
  status!: string;
  @ApiProperty({ type: Object, required: false })
  attributes?: Record<string, unknown>;
}
