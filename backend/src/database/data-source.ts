import 'dotenv/config';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { ShareLog } from '../share/share-log.entity';
import { Share } from '../share/share.entity';
import { User } from '../user/user.entity';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'fManage',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [User, Share, ShareLog],
  migrations: [path.join(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
});

export default AppDataSource;
