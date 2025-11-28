import { Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'vehicle_pool_members' })
export class VehiclePoolMemberEntity {
  @PrimaryColumn({ type: 'uuid' })
  pool_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  vehicle_id!: string;
}
