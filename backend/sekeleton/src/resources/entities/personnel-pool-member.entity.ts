import { Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'personnel_pool_members' })
export class PersonnelPoolMemberEntity {
  @PrimaryColumn({ type: 'uuid' })
  pool_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  personnel_id!: string;
}
