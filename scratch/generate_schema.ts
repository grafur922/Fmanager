import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { User } from '../src/user/user.entity';
import { Share } from '../src/share/share.entity';
import { ShareLog } from '../src/share/share-log.entity';
import * as path from 'path';

// 加载环境变量
dotenv.config({ path: path.join(__dirname, '../.env') });

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'fManage',
  entities: [User, Share, ShareLog],
  synchronize: false,
});

async function main() {
  try {
    await dataSource.initialize();
    
    // 获取 SchemaBuilder
    const builder = dataSource.driver.createSchemaBuilder();
    const result = await builder.log();
    
    console.log('\n================== POSTGRESQL SCHEMA SQL START ==================\n');
    console.log('-- Enable UUID extension');
    console.log('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n');
    
    result.upQueries.forEach((q) => {
      // 替换参数占位符（如果有的话，TypeORM 生成的建表 SQL 通常不带参数）
      let query = q.query;
      if (!query.endsWith(';')) {
        query += ';';
      }
      console.log(query);
      console.log(''); // 空行分隔
    });
    
    console.log('=================== POSTGRESQL SCHEMA SQL END ===================\n');
    
    await dataSource.destroy();
  } catch (error) {
    console.error('Error generating schema:', error);
    process.exit(1);
  }
}

main();
