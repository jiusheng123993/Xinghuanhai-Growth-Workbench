-- 037: 聊天多会话（豆包式「新建对话」）
-- 目的：聊天记录从「每宠物一条无限平铺时间线」升级为「多会话」——
--       用户可新建/切换/删除会话，单会话短，上下文与 agent_conversations 表都不会无限膨胀。
--
-- 设计：
--   1. 新建 chat_sessions 会话主体表
--      - user_id 用 UUID 对齐 users.id（项目新表规范，迁移 018/028 注释均强调 users.id 是 uuid）
--      - pet_id 用 TEXT 对齐 pet_profiles.id（该列历史就是 text，迁移 014 注释已确认，不可建 UUID 外键）
--   2. agent_conversations 加 session_id 列（TEXT，存 UUID 字符串，与 pet_id 同风格）
--      - agent_conversations 是迁移体系外的历史建表（建表在 04-数据库/postgres/init.sql），
--        其 user_id/pet_id 均为 TEXT，加外键会因 TEXT↔UUID 类型不匹配失败，故 session_id 不建外键
--   3. 存量 session_id IS NULL 的历史消息，由后端在「首次新建会话」时惰性归并到该会话
--      （mergeLegacyMessages），本迁移只加列不搬数据，避免 plpgsql 循环复杂化
-- 幂等：IF NOT EXISTS / ADD COLUMN IF NOT EXISTS，可重复执行。

-- ============================================================
-- 1. 会话主体表
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id        TEXT,
  title         TEXT NOT NULL DEFAULT '新的对话',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);

-- 按用户列出会话（列表页按最近活跃排序）
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);
-- 按宠物列出会话（首页按当前宠物加载）
CREATE INDEX IF NOT EXISTS idx_chat_sessions_pet ON chat_sessions(pet_id, updated_at DESC);

-- ============================================================
-- 2. 对话消息表加会话归属列
-- ============================================================
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS session_id TEXT;

-- 按会话查历史（loadConversationHistory 按 session 拉取）
CREATE INDEX IF NOT EXISTS idx_agent_conv_session ON agent_conversations(session_id, created_at);
