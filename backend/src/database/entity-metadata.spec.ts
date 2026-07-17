import { DataSource } from 'typeorm';
import { ShareLog } from '../share/share-log.entity';
import { Share } from '../share/share.entity';
import { User } from '../user/user.entity';

class MetadataTestDataSource extends DataSource {
  async buildMetadataForTest(): Promise<void> {
    await this.buildMetadatas();
  }
}

describe('TypeORM entity metadata', () => {
  it('maps nullable share passwords to PostgreSQL varchar', async () => {
    const dataSource = new MetadataTestDataSource({
      type: 'postgres',
      entities: [User, Share, ShareLog],
      synchronize: false,
    });

    await dataSource.buildMetadataForTest();
    const column = dataSource
      .getMetadata(Share)
      .findColumnWithPropertyName('passwordHash');

    expect(column?.type).toBe('varchar');
    expect(column?.isNullable).toBe(true);
    expect(column?.isSelect).toBe(false);
  });
});
