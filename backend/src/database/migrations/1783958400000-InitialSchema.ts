import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1783958400000 implements MigrationInterface {
  name = 'InitialSchema1783958400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" SERIAL NOT NULL,
        "username" character varying NOT NULL,
        "passwordHash" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_username" ON "users" ("username")',
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shares" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "path" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "user_id" integer NOT NULL,
        CONSTRAINT "PK_shares_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" ALTER COLUMN "path" TYPE text',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_shares_user_id" ON "shares" ("user_id")',
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_shares_user'
        ) THEN
          ALTER TABLE "shares"
          ADD CONSTRAINT "FK_shares_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "share_logs" (
        "id" SERIAL NOT NULL,
        "ip" character varying NOT NULL,
        "userAgent" text,
        "accessedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "share_id" uuid NOT NULL,
        CONSTRAINT "PK_share_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "share_logs" ALTER COLUMN "userAgent" TYPE text',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_share_logs_share_id" ON "share_logs" ("share_id")',
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_share_logs_share'
        ) THEN
          ALTER TABLE "share_logs"
          ADD CONSTRAINT "FK_share_logs_share"
          FOREIGN KEY ("share_id") REFERENCES "shares"("id")
          ON DELETE CASCADE;
        END IF;
      END $$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "share_logs" DROP CONSTRAINT IF EXISTS "FK_share_logs_share"',
    );
    await queryRunner.query(
      'ALTER TABLE IF EXISTS "shares" DROP CONSTRAINT IF EXISTS "FK_shares_user"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "share_logs"');
    await queryRunner.query('DROP TABLE IF EXISTS "shares"');
    await queryRunner.query('DROP TABLE IF EXISTS "users"');
  }
}
