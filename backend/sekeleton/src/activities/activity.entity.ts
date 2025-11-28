import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'activities' })
export class ActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'boolean', default: false })
  deleted!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_at!: string | null;

  @Column({ type: 'timestamptz' })
  start_time!: string;

  @Column({ type: 'timestamptz', nullable: true })
  end_time!: string | null;

  @Column({ type: 'boolean', default: false })
  is_open_ended!: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updated_at!: string;

  @Column({ type: 'jsonb' })
  attributes!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  audit_trail!: unknown[];
}
