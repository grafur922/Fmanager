import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Share } from './share.entity';

@Entity('share_logs')
export class ShareLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  ip: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @CreateDateColumn()
  accessedAt: Date;

  @ManyToOne(() => Share, (share) => share.logs, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'share_id' })
  share: Share;
}
