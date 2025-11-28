import { Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'vehicle_service_pool_members' })
export class VehicleServicePoolMemberEntity {
  @PrimaryColumn({ type: 'uuid' })
  pool_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  service_id!: string;
}
