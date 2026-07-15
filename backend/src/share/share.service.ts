import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { ShareLog } from './share-log.entity';
import { Share } from './share.entity';

export type ShareStatus = 'active' | 'disabled' | 'expired' | 'limit_reached';

export interface ShareLogView {
  id: number;
  ip: string;
  userAgent: string | null;
  accessedAt: Date;
}

export interface ShareView {
  id: string;
  name: string;
  path: string;
  createdAt: Date;
  expiresAt: Date;
  isEnabled: boolean;
  hasPassword: boolean;
  maxDownloads: number | null;
  downloadCount: number;
  remainingDownloads: number | null;
  status: ShareStatus;
  logs: ShareLogView[];
}

export interface PublicShareView {
  id: string;
  name: string;
  createdAt: Date;
  expiresAt: Date;
  requiresPassword: boolean;
  maxDownloads: number | null;
  downloadCount: number;
  remainingDownloads: number | null;
  status: ShareStatus;
}

export interface CreateShareInput {
  path: string;
  name: string;
  days: number;
  password?: string;
  maxDownloads?: number | null;
}

export interface UpdateShareInput {
  isEnabled?: boolean;
  days?: number;
  password?: string | null;
  maxDownloads?: number | null;
}

export interface ShareDownloadResource {
  name: string;
  path: string;
}

interface DownloadGrant {
  shareId: string;
  expiresAt: number;
}

interface FailedPasswordAttempts {
  count: number;
  resetAt: number;
}

@Injectable()
export class ShareService {
  private readonly downloadGrants = new Map<string, DownloadGrant>();
  private readonly failedPasswordAttempts = new Map<
    string,
    FailedPasswordAttempts
  >();
  private readonly downloadGrantTtlMs = this.readPositiveInteger(
    'SHARE_DOWNLOAD_TOKEN_TTL_MS',
    2 * 60 * 1000,
  );
  private readonly passwordAttemptWindowMs = this.readPositiveInteger(
    'SHARE_PASSWORD_ATTEMPT_WINDOW_MS',
    15 * 60 * 1000,
  );
  private readonly passwordMaxAttempts = this.readPositiveInteger(
    'SHARE_PASSWORD_MAX_ATTEMPTS',
    5,
  );
  private readonly maxPendingDownloadGrants = this.readPositiveInteger(
    'SHARE_MAX_PENDING_DOWNLOADS',
    10_000,
  );

  constructor(
    @InjectRepository(Share)
    private readonly shareRepository: Repository<Share>,
  ) {}

  async createShare(input: CreateShareInput, user: User): Promise<ShareView> {
    const days = this.validateDays(input.days);
    const maxDownloads = this.validateMaxDownloads(input.maxDownloads, true);
    const passwordHash = input.password
      ? await bcrypt.hash(this.validatePassword(input.password), 10)
      : null;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const share = this.shareRepository.create({
      path: input.path,
      name: input.name,
      expiresAt,
      isEnabled: true,
      maxDownloads,
      downloadCount: 0,
      passwordHash,
      user,
      logs: [],
    });
    const saved = await this.shareRepository.save(share);
    return this.toShareView(saved);
  }

  async listShares(ownerId?: number): Promise<ShareView[]> {
    const query = this.shareRepository
      .createQueryBuilder('share')
      .addSelect('share.passwordHash')
      .leftJoinAndSelect('share.logs', 'log')
      .orderBy('share.createdAt', 'DESC')
      .addOrderBy('log.accessedAt', 'DESC');
    if (ownerId !== undefined) {
      query
        .innerJoin('share.user', 'owner')
        .andWhere('owner.id = :ownerId', { ownerId });
    }
    return (await query.getMany()).map((share) => this.toShareView(share));
  }

  async getShareStats(
    ownerId?: number,
  ): Promise<{ totalShares: number; activeShares: number }> {
    const baseQuery = this.shareRepository.createQueryBuilder('share');
    if (ownerId !== undefined) {
      baseQuery
        .innerJoin('share.user', 'owner')
        .andWhere('owner.id = :ownerId', { ownerId });
    }

    const [totalShares, activeShares] = await Promise.all([
      baseQuery.clone().getCount(),
      baseQuery
        .clone()
        .andWhere('share.isEnabled = true')
        .andWhere('share.expiresAt > :now', { now: new Date() })
        .andWhere(
          '(share.maxDownloads IS NULL OR share.downloadCount < share.maxDownloads)',
        )
        .getCount(),
    ]);
    return { totalShares, activeShares };
  }

  async updateShare(
    id: string,
    ownerId: number,
    input: UpdateShareInput,
  ): Promise<ShareView> {
    if (
      input.isEnabled === undefined &&
      input.days === undefined &&
      input.password === undefined &&
      input.maxDownloads === undefined
    ) {
      throw new BadRequestException('没有可更新的分享设置');
    }

    const share = await this.findOwnedShareWithPassword(id, ownerId);
    if (!share) throw new NotFoundException('分享不存在');

    if (input.isEnabled !== undefined) {
      if (typeof input.isEnabled !== 'boolean') {
        throw new BadRequestException('分享启用状态无效');
      }
      share.isEnabled = input.isEnabled;
    }
    if (input.days !== undefined) {
      const days = this.validateDays(input.days);
      share.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    if (input.maxDownloads !== undefined) {
      share.maxDownloads = this.validateMaxDownloads(input.maxDownloads, false);
    }
    if (input.password !== undefined) {
      share.passwordHash =
        input.password === null
          ? null
          : await bcrypt.hash(this.validatePassword(input.password), 10);
    }

    await this.shareRepository.save(share);
    this.revokeDownloadGrants(id);
    return this.getOwnedShare(id, ownerId);
  }

  async deleteShare(id: string, ownerId: number): Promise<void> {
    const share = await this.shareRepository.findOne({
      where: { id, user: { id: ownerId } },
    });
    if (!share) throw new NotFoundException('分享不存在');
    await this.shareRepository.remove(share);
    this.revokeDownloadGrants(id);
  }

  async getPublicShare(id: string): Promise<PublicShareView> {
    const share = await this.findShareWithPassword(id);
    if (!share) throw new NotFoundException('分享链接不存在');
    return this.toPublicShareView(share);
  }

  async getDownloadCandidate(
    id: string,
  ): Promise<ShareDownloadResource & { requiresPassword: boolean }> {
    const share = await this.findShareWithPassword(id);
    if (!share) throw new NotFoundException('分享链接不存在');
    this.assertShareAvailable(share);
    return {
      name: share.name,
      path: share.path,
      requiresPassword: Boolean(share.passwordHash),
    };
  }

  async authorizeDownload(
    id: string,
    password: string | undefined,
    clientIp: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const share = await this.findShareWithPassword(id);
    if (!share) throw new NotFoundException('分享链接不存在');
    this.assertShareAvailable(share);

    const attemptKey = this.getAttemptKey(id, clientIp);
    if (share.passwordHash) {
      this.assertPasswordAttemptsAvailable(attemptKey);
      const passwordMatches =
        typeof password === 'string' &&
        (await bcrypt.compare(password, share.passwordHash));
      if (!passwordMatches) {
        const blocked = this.recordFailedPasswordAttempt(attemptKey);
        if (blocked) {
          throw this.createTooManyRequestsException();
        }
        throw new ForbiddenException(
          password ? '分享密码错误' : '请输入分享密码',
        );
      }
      this.failedPasswordAttempts.delete(attemptKey);
    }

    this.cleanupEphemeralState();
    if (this.downloadGrants.size >= this.maxPendingDownloadGrants) {
      throw this.createTooManyRequestsException('下载请求过多，请稍后再试');
    }
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + this.downloadGrantTtlMs);
    this.downloadGrants.set(token, {
      shareId: id,
      expiresAt: expiresAt.getTime(),
    });
    return { token, expiresAt };
  }

  async consumeDownloadGrant(
    id: string,
    token: string,
    ip: string,
    userAgent: string,
  ): Promise<ShareDownloadResource> {
    this.cleanupEphemeralState();
    const grant = this.downloadGrants.get(token);
    if (!grant || grant.shareId !== id || grant.expiresAt <= Date.now()) {
      throw new ForbiddenException('下载凭证无效或已经过期');
    }
    this.downloadGrants.delete(token);
    return this.recordDownload(id, ip, userAgent, true);
  }

  async consumeDirectDownload(
    id: string,
    ip: string,
    userAgent: string,
  ): Promise<ShareDownloadResource> {
    return this.recordDownload(id, ip, userAgent, false);
  }

  private async getOwnedShare(id: string, ownerId: number): Promise<ShareView> {
    const query = this.shareRepository
      .createQueryBuilder('share')
      .addSelect('share.passwordHash')
      .leftJoinAndSelect('share.logs', 'log')
      .innerJoin('share.user', 'owner')
      .where('share.id = :id', { id })
      .andWhere('owner.id = :ownerId', { ownerId })
      .orderBy('log.accessedAt', 'DESC');
    const share = await query.getOne();
    if (!share) throw new NotFoundException('分享不存在');
    return this.toShareView(share);
  }

  private async findOwnedShareWithPassword(
    id: string,
    ownerId: number,
  ): Promise<Share | null> {
    return this.shareRepository
      .createQueryBuilder('share')
      .addSelect('share.passwordHash')
      .innerJoin('share.user', 'owner')
      .where('share.id = :id', { id })
      .andWhere('owner.id = :ownerId', { ownerId })
      .getOne();
  }

  private async findShareWithPassword(
    id: string,
    manager?: EntityManager,
    lock = false,
  ): Promise<Share | null> {
    const repository = manager
      ? manager.getRepository(Share)
      : this.shareRepository;
    const query = repository
      .createQueryBuilder('share')
      .addSelect('share.passwordHash')
      .where('share.id = :id', { id });
    if (lock) query.setLock('pessimistic_write');
    return query.getOne();
  }

  private async recordDownload(
    id: string,
    ip: string,
    userAgent: string,
    allowPasswordProtected: boolean,
  ): Promise<ShareDownloadResource> {
    return this.shareRepository.manager.transaction(async (manager) => {
      const share = await this.findShareWithPassword(id, manager, true);
      if (!share) throw new NotFoundException('分享链接不存在');
      this.assertShareAvailable(share);
      if (!allowPasswordProtected && share.passwordHash) {
        throw new ForbiddenException('该分享需要先验证密码');
      }

      share.downloadCount = Number(share.downloadCount || 0) + 1;
      await manager.getRepository(Share).save(share);
      const logRepository = manager.getRepository(ShareLog);
      const log = logRepository.create({
        ip: String(ip || 'unknown').slice(0, 255),
        userAgent: String(userAgent || 'unknown').slice(0, 1000),
        share,
      });
      await logRepository.save(log);
      return { name: share.name, path: share.path };
    });
  }

  private assertShareAvailable(share: Share): void {
    const status = this.getShareStatus(share);
    if (status === 'disabled') {
      throw new ForbiddenException('该分享已停用');
    }
    if (status === 'expired') {
      throw new GoneException('该分享已经过期');
    }
    if (status === 'limit_reached') {
      throw new GoneException('该分享的下载次数已经用完');
    }
  }

  private getShareStatus(share: Share): ShareStatus {
    if (!share.isEnabled) return 'disabled';
    if (new Date(share.expiresAt).getTime() <= Date.now()) return 'expired';
    if (
      share.maxDownloads !== null &&
      Number(share.downloadCount || 0) >= share.maxDownloads
    ) {
      return 'limit_reached';
    }
    return 'active';
  }

  private toShareView(share: Share): ShareView {
    return {
      id: share.id,
      name: share.name,
      path: share.path,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      isEnabled: share.isEnabled,
      hasPassword: Boolean(share.passwordHash),
      maxDownloads: share.maxDownloads ?? null,
      downloadCount: Number(share.downloadCount || 0),
      remainingDownloads: this.getRemainingDownloads(share),
      status: this.getShareStatus(share),
      logs: (share.logs || []).map((log) => ({
        id: log.id,
        ip: log.ip,
        userAgent: log.userAgent,
        accessedAt: log.accessedAt,
      })),
    };
  }

  private toPublicShareView(share: Share): PublicShareView {
    return {
      id: share.id,
      name: share.name,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      requiresPassword: Boolean(share.passwordHash),
      maxDownloads: share.maxDownloads ?? null,
      downloadCount: Number(share.downloadCount || 0),
      remainingDownloads: this.getRemainingDownloads(share),
      status: this.getShareStatus(share),
    };
  }

  private getRemainingDownloads(share: Share): number | null {
    return share.maxDownloads === null || share.maxDownloads === undefined
      ? null
      : Math.max(0, share.maxDownloads - Number(share.downloadCount || 0));
  }

  private validateDays(value: number): number {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new BadRequestException('分享有效期必须在 1 到 365 天之间');
    }
    return days;
  }

  private validateMaxDownloads(
    value: number | null | undefined,
    allowUndefined: boolean,
  ): number | null {
    if (value === null || (value === undefined && allowUndefined)) return null;
    const maxDownloads = Number(value);
    if (
      !Number.isInteger(maxDownloads) ||
      maxDownloads < 1 ||
      maxDownloads > 1_000_000
    ) {
      throw new BadRequestException('下载次数上限必须在 1 到 1000000 之间');
    }
    return maxDownloads;
  }

  private validatePassword(password: string): string {
    if (
      typeof password !== 'string' ||
      password.trim().length < 4 ||
      password.length > 64
    ) {
      throw new BadRequestException('分享密码长度必须在 4 到 64 个字符之间');
    }
    return password;
  }

  private getAttemptKey(id: string, ip: string): string {
    return `${id}:${String(ip || 'unknown').slice(0, 255)}`;
  }

  private assertPasswordAttemptsAvailable(key: string): void {
    const attempts = this.failedPasswordAttempts.get(key);
    if (!attempts) return;
    if (attempts.resetAt <= Date.now()) {
      this.failedPasswordAttempts.delete(key);
      return;
    }
    if (attempts.count >= this.passwordMaxAttempts) {
      throw this.createTooManyRequestsException();
    }
  }

  private recordFailedPasswordAttempt(key: string): boolean {
    const now = Date.now();
    const existing = this.failedPasswordAttempts.get(key);
    const attempts =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + this.passwordAttemptWindowMs };
    attempts.count += 1;
    this.failedPasswordAttempts.set(key, attempts);
    return attempts.count >= this.passwordMaxAttempts;
  }

  private revokeDownloadGrants(shareId: string): void {
    for (const [token, grant] of this.downloadGrants) {
      if (grant.shareId === shareId) this.downloadGrants.delete(token);
    }
  }

  private cleanupEphemeralState(): void {
    const now = Date.now();
    for (const [token, grant] of this.downloadGrants) {
      if (grant.expiresAt <= now) this.downloadGrants.delete(token);
    }
    for (const [key, attempts] of this.failedPasswordAttempts) {
      if (attempts.resetAt <= now) this.failedPasswordAttempts.delete(key);
    }
  }

  private readPositiveInteger(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  private createTooManyRequestsException(
    message = '密码尝试次数过多，请稍后再试',
  ): HttpException {
    return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
