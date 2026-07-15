import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShareAccessControls1784044800000 implements MigrationInterface {
  name = 'ShareAccessControls1784044800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" ADD COLUMN IF NOT EXISTS "passwordHash" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" ADD COLUMN IF NOT EXISTS "isEnabled" boolean NOT NULL DEFAULT true',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" ADD COLUMN IF NOT EXISTS "maxDownloads" integer',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" ADD COLUMN IF NOT EXISTS "downloadCount" integer NOT NULL DEFAULT 0',
    );
    await queryRunner.query(`
      UPDATE "shares" AS share
      SET "downloadCount" = access_log.total
      FROM (
        SELECT "share_id", COUNT(*)::integer AS total
        FROM "share_logs"
        GROUP BY "share_id"
      ) AS access_log
      WHERE share."id" = access_log."share_id"
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_shares_max_downloads'
        ) THEN
          ALTER TABLE "shares"
          ADD CONSTRAINT "CHK_shares_max_downloads"
          CHECK ("maxDownloads" IS NULL OR "maxDownloads" > 0);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_shares_download_count'
        ) THEN
          ALTER TABLE "shares"
          ADD CONSTRAINT "CHK_shares_download_count"
          CHECK ("downloadCount" >= 0);
        END IF;
      END $$
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_shares_availability" ON "shares" ("isEnabled", "expiresAt")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_shares_availability"');
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" DROP CONSTRAINT IF EXISTS "CHK_shares_download_count"',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" DROP CONSTRAINT IF EXISTS "CHK_shares_max_downloads"',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" DROP COLUMN IF EXISTS "downloadCount"',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" DROP COLUMN IF EXISTS "maxDownloads"',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" DROP COLUMN IF EXISTS "isEnabled"',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" DROP COLUMN IF EXISTS "passwordHash"',
    );
  }
}
