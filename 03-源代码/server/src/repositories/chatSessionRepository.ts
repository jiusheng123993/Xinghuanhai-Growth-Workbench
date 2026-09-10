/**
 * 聊天会话数据访问层 - chat_sessions 表
 *
 * 背景（2026-09-10 多会话改造）：聊天记录从「每宠物一条无限平铺时间线」升级为「多会话」，
 * 用户可新建/切换/删除会话。本仓库负责会话生命周期（增删查）+ 存量消息归并。
 *
 * 类型注意：chat_sessions.id 与 user_id 均为 UUID，比较时统一 `::text` 转文本，
 * 避免 node-postgres 传字符串时触发 uuid/text 运算符歧义。
 */
import { BaseRepository } from './baseRepository.js';
import type { QueryResultRow } from 'pg';

/** chat_sessions 数据行 */
export interface ChatSessionRow extends QueryResultRow {
  id: string;
  user_id: string;
  pet_id: string | null;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** 会话摘要（响应给前端，snake→camel） */
export interface ChatSessionSummary {
  id: string;
  petId: string | null;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 数据行 → 前端摘要 */
export function toSessionSummary(row: ChatSessionRow): ChatSessionSummary {
  return {
    id: row.id,
    petId: row.pet_id,
    title: row.title,
    messageCount: Number(row.message_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ChatSessionRepository extends BaseRepository<ChatSessionRow> {
  protected tableName = 'chat_sessions';
  protected allowedSortFields = ['created_at', 'updated_at', 'message_count'] as const;

  /**
   * 创建会话
   * title 默认「新的对话」；首条用户消息落库时由 saveConversation 更新为消息截断
   */
  async createSession(userId: string, petId: string | null, title = '新的对话'): Promise<ChatSessionRow> {
    return this.insert({ user_id: userId, pet_id: petId, title });
  }

  /** 按 id + user 查询（归属校验，防横向越权） */
  async findByIdAndUser(id: string, userId: string): Promise<ChatSessionRow | null> {
    return this.findOneWhere('id::text = $1 AND user_id::text = $2', [id, userId]);
  }

  /** 列出某用户会话（可按宠物过滤），按 updated_at 倒序（列表/首页加载） */
  async listByUser(userId: string, petId?: string | null, limit = 50): Promise<ChatSessionRow[]> {
    if (petId) {
      return this.findManyWhere(
        'user_id::text = $1 AND pet_id = $2',
        [userId, petId],
        { orderBy: 'updated_at', sortDirection: 'DESC', limit },
      );
    }
    return this.findManyWhere(
      'user_id::text = $1',
      [userId],
      { orderBy: 'updated_at', sortDirection: 'DESC', limit },
    );
  }

  /**
   * 删除会话 + 手动级联删除其消息
   * agent_conversations 是迁移体系外的历史建表（无外键），需显式删除消息再删会话
   */
  async deleteSession(id: string, userId: string): Promise<boolean> {
    const session = await this.findByIdAndUser(id, userId);
    if (!session) return false;
    await this.rawQuery('DELETE FROM agent_conversations WHERE session_id = $1', [id]);
    await this.rawQuery('DELETE FROM chat_sessions WHERE id::text = $1', [id]);
    return true;
  }

  /**
   * 存量消息归并：首次新建会话时，把该宠物下 session_id IS NULL 的历史消息归入新会话
   * 存量兼容（升级前的老消息无 session_id），只生效一次（归并后不再有 NULL）
   * pet_id 用 IS NOT DISTINCT FROM 处理 NULL 比较
   */
  async mergeLegacyMessages(userId: string, petId: string | null, sessionId: string): Promise<void> {
    await this.rawQuery(
      `UPDATE agent_conversations SET session_id = $1
       WHERE user_id = $2 AND pet_id IS NOT DISTINCT FROM $3 AND session_id IS NULL`,
      [sessionId, userId, petId],
    );
  }

  /** 触达会话：消息落库后维护 message_count 与 updated_at（列表排序 + 软提示阈值依据） */
  async touchSession(id: string, increment: number): Promise<void> {
    await this.rawQuery(
      `UPDATE chat_sessions
       SET message_count = message_count + $2, updated_at = now()
       WHERE id::text = $1`,
      [id, increment],
    );
  }

  /** 首条用户消息时更新会话标题（仅当标题仍是默认「新的对话」，保留用户语义） */
  async updateTitleIfDefault(id: string, title: string): Promise<void> {
    await this.rawQuery(
      `UPDATE chat_sessions SET title = $2 WHERE id::text = $1 AND title = '新的对话'`,
      [id, title],
    );
  }
}
