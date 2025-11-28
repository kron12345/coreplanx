import { Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'personnel_service_pool_members' })
export class PersonnelServicePoolMemberEntity {
  @PrimaryColumn({ type: 'uuid' })
  pool_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  service_id!: string;
}
