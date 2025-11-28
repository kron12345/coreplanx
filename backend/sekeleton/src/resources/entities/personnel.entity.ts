import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'personnel' })
export class PersonnelEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  external_ref!: string | null;

  @Column({ type: 'text', nullable: true })
  home_base!: string | null;

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
