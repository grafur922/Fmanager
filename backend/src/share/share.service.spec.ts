import { ForbiddenException, GoneException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { ShareLog } from './share-log.entity';
import { Share } from './share.entity';
import { ShareService } from './share.service';

describe('ShareService', () => {
  let service: ShareService;
  let repository: Repository<Share>;
  let createMock: jest.Mock;
  let saveMock: jest.Mock;
  let removeMock: jest.Mock;
  let findOneMock: jest.Mock;
  let createQueryBuilderMock: jest.Mock;
  let transactionMock: jest.Mock;

  beforeEach(() => {
    createMock = jest.fn((input: Partial<Share>) => input as Share);
    saveMock = jest.fn((share: Share) => Promise.resolve(share));
    removeMock = jest.fn((share: Share) => Promise.resolve(share));
    findOneMock = jest.fn();
    createQueryBuilderMock = jest.fn();
    transactionMock = jest.fn();
    repository = {
      create: createMock,
      save: saveMock,
      remove: removeMock,
      findOne: findOneMock,
      createQueryBuilder: createQueryBuilderMock,
      manager: { transaction: transactionMock },
    } as unknown as Repository<Share>;
    service = new ShareService(repository);
  });

  it('hashes share passwords and never returns password or user secrets', async () => {
    const now = new Date();
    let persisted: Share | undefined;
    createMock.mockImplementation((input: Partial<Share>) => {
      persisted = makeShare({ ...input, id: 'share-1', createdAt: now });
      return persisted;
    });

    const result = await service.createShare(
      {
        path: '/documents/report.pdf',
        name: 'report.pdf',
        days: 7,
        password: 'safe-password',
        maxDownloads: 3,
      },
      { id: 7, passwordHash: 'user-secret' } as User,
    );

    if (!persisted?.passwordHash) throw new Error('Expected a password hash');
    expect(await bcrypt.compare('safe-password', persisted.passwordHash)).toBe(
      true,
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'share-1',
        hasPassword: true,
        maxDownloads: 3,
        downloadCount: 0,
        remainingDownloads: 3,
        status: 'active',
      }),
    );
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('user');
  });

  it('strips hidden entity fields from owner share listings', async () => {
    const entity = makeShare({
      passwordHash: 'share-secret',
      user: { id: 7, passwordHash: 'user-secret' } as User,
      logs: [
        {
          id: 1,
          ip: '127.0.0.1',
          userAgent: 'jest',
          accessedAt: new Date(),
        } as ShareLog,
      ],
    });
    createQueryBuilderMock.mockReturnValue(queryBuilder({ many: [entity] }));

    const [result] = await service.listShares(7);
    expect(result.hasPassword).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('user');
  });

  it('consumes a download grant once and records the download atomically', async () => {
    const passwordHash = await bcrypt.hash('safe-password', 4);
    const share = makeShare({ passwordHash, maxDownloads: 2 });
    createQueryBuilderMock.mockReturnValue(queryBuilder({ one: share }));

    const grant = await service.authorizeDownload(
      share.id,
      'safe-password',
      '127.0.0.1',
    );

    const lockedShare = makeShare({
      id: share.id,
      passwordHash,
      maxDownloads: 2,
      downloadCount: 0,
    });
    const transactionalShareRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder({ one: lockedShare })),
      save: jest.fn((value: Share) => Promise.resolve(value)),
    };
    const transactionalLogRepository = {
      create: jest.fn((value: Partial<ShareLog>) => value as ShareLog),
      save: jest.fn((value: ShareLog) => Promise.resolve(value)),
    };
    const manager = {
      getRepository: jest.fn((entity: typeof Share | typeof ShareLog) =>
        entity === Share
          ? transactionalShareRepository
          : transactionalLogRepository,
      ),
    } as unknown as EntityManager;
    transactionMock.mockImplementation(
      async (operation: (manager: EntityManager) => Promise<unknown>) =>
        operation(manager),
    );

    await expect(
      service.consumeDownloadGrant(
        share.id,
        grant.token,
        '127.0.0.1',
        'jest-agent',
      ),
    ).resolves.toEqual({ name: share.name, path: share.path });
    expect(lockedShare.downloadCount).toBe(1);
    expect(transactionalShareRepository.save).toHaveBeenCalledWith(lockedShare);
    expect(transactionalLogRepository.save).toHaveBeenCalledTimes(1);

    await expect(
      service.consumeDownloadGrant(
        share.id,
        grant.token,
        '127.0.0.1',
        'jest-agent',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports and rejects shares whose download limit is exhausted', async () => {
    const share = makeShare({ maxDownloads: 2, downloadCount: 2 });
    createQueryBuilderMock.mockReturnValue(queryBuilder({ one: share }));

    await expect(service.getPublicShare(share.id)).resolves.toEqual(
      expect.objectContaining({
        status: 'limit_reached',
        remainingDownloads: 0,
      }),
    );
    await expect(service.getDownloadCandidate(share.id)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('rejects invalid password and download-limit inputs', async () => {
    await expect(
      service.createShare(
        {
          path: '/documents/report.pdf',
          name: 'report.pdf',
          days: 7,
          password: '123',
        },
        { id: 7 } as User,
      ),
    ).rejects.toThrow('分享密码长度必须在 4 到 64 个字符之间');

    await expect(
      service.createShare(
        {
          path: '/documents/report.pdf',
          name: 'report.pdf',
          days: 7,
          maxDownloads: 0,
        },
        { id: 7 } as User,
      ),
    ).rejects.toThrow('下载次数上限必须在 1 到 1000000 之间');
  });
});

function makeShare(overrides: Partial<Share> = {}): Share {
  return {
    id: 'share-id',
    name: 'report.pdf',
    path: '/documents/report.pdf',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    isEnabled: true,
    maxDownloads: null,
    downloadCount: 0,
    passwordHash: null,
    user: { id: 7 } as User,
    logs: [],
    ...overrides,
  };
}

function queryBuilder(options: {
  one?: Share | null;
  many?: Share[];
  count?: number;
}) {
  const builder = {
    addSelect: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    setLock: jest.fn(),
    clone: jest.fn(),
    getOne: jest.fn().mockResolvedValue(options.one ?? null),
    getMany: jest.fn().mockResolvedValue(options.many ?? []),
    getCount: jest.fn().mockResolvedValue(options.count ?? 0),
  };
  for (const method of [
    builder.addSelect,
    builder.leftJoinAndSelect,
    builder.innerJoin,
    builder.where,
    builder.andWhere,
    builder.orderBy,
    builder.addOrderBy,
    builder.setLock,
  ]) {
    method.mockReturnValue(builder);
  }
  builder.clone.mockReturnValue(builder);
  return builder;
}
