import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { ShareLog } from './share-log.entity';

@Entity('shares')
export class Share {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  path: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ type: 'integer', nullable: true })
  maxDownloads: number | null;

  @Column({ type: 'integer', default: 0 })
  downloadCount: number;

  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  @ManyToOne(() => User, (user) => user.shares, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => ShareLog, (log) => log.share, { cascade: true })
  logs: ShareLog[];
}
