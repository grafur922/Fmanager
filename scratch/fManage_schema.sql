-- ====================================================================
-- fManage PostgreSQL 数据库结构创建脚本 (Schema Creation Script)
-- 基于 NestJS + TypeORM 实体定义生成
-- 适用于：PostgreSQL 12+ (Ubuntu 22.04 / Windows 11)
-- ====================================================================
 
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 创建 "users" 表
-- ==========================================
CREATE TABLE IF NOT EXISTS "users" (
    "id" SERIAL NOT NULL,
    "username" CHARACTER VARYING NOT NULL,
    "passwordHash" CHARACTER VARYING NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_users_username" UNIQUE ("username")
);

-- ==========================================
-- 创建 "shares" 表
-- ==========================================
CREATE TABLE IF NOT EXISTS "shares" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" CHARACTER VARYING NOT NULL,
    "path" CHARACTER VARYING NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "user_id" INTEGER,
    CONSTRAINT "PK_shares_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_shares_user" FOREIGN KEY ("user_id") 
        REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- ==========================================
-- 创建 "share_logs" 表
-- ==========================================
CREATE TABLE IF NOT EXISTS "share_logs" (
    "id" SERIAL NOT NULL,
    "ip" CHARACTER VARYING NOT NULL,
    "userAgent" CHARACTER VARYING,
    "accessedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "share_id" UUID,
    CONSTRAINT "PK_share_logs_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_share_logs_share" FOREIGN KEY ("share_id") 
        REFERENCES "shares" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS "IDX_shares_user_id" ON "shares" ("user_id");
CREATE INDEX IF NOT EXISTS "IDX_share_logs_share_id" ON "share_logs" ("share_id");
