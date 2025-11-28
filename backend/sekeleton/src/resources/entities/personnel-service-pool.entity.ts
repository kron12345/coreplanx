import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'personnel_service_pools' })
export class PersonnelServicePoolEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', default: false })
  deleted!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_at!: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  attributes!: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updated_at!: string;
}
