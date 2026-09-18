/**
 * 邀请裂变路由
 *
 * 提供邀请码、分享记录、推荐关系与邀请奖励（会员天数）接口，
 * 与小程序端 shareService 的调用约定保持一致（/api/invite-code、/api/shares、/api/referrals）。
 */
import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { pool } from '../db.js';
import { sanitizeError } from '../utils/sanitize.js';

const router = Router();

/** 邀请奖励规则：邀请满 3 位好友，奖励 7 天会员（与小程序端 constants 保持一致） */
const SHARE_REWARD_INVITES = 3;
const REWARD_DAYS = 7;

/** 分享动作 schema（card_type 与小程序端 ShareCardType 对齐） */
const shareSchema = z.object({
  card_type: z.string().min(1).max(32),
  pet_id: z.string().uuid().nullable().optional(),
  platform: z.string().max(32).optional().default('wechat'),
  invite_code: z.string().max(16).optional(),
});

/** 处理推荐关系 schema */
const processReferralSchema = z.object({
  invite_code: z.string().min(4).max(16),
  invitee_id: z.string().uuid(),
});

/** 生成邀请码（排除易混淆字符 O/0/I/1） */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * 计算奖励后的会员到期时间
 * 会员仍在有效期内则顺延，否则从现在起算
 */
export function computeNewExpiresAt(current: Date | null, now: Date, days: number): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** GET /api/invite-code - 获取/创建当前用户邀请码（已存在则复用） */
router.get('/invite-code', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const existing = await pool.query(`SELECT code FROM invite_codes WHERE user_id = $1`, [userId]);
    if (existing.rows.length > 0) {
      res.json({ code: existing.rows[0].code });
      return;
    }
    // 生成唯一邀请码（唯一键冲突时重试）
    let code = generateInviteCode();
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      try {
        await pool.query(`INSERT INTO invite_codes (user_id, code) VALUES ($1, $2)`, [userId, code]);
        inserted = true;
      } catch {
        code = generateInviteCode();
      }
    }
    if (!inserted) throw new Error('邀请码生成失败');
    res.json({ code });
  } catch (error) {
    console.error('[Invite] 获取邀请码失败:', sanitizeError(error));
    res.status(500).json({ success: false, message: '获取邀请码失败' });
  }
});

/** POST /api/shares - 记录一次分享动作 */
router.post(
  '/shares',
  authMiddleware,
  validate({ body: shareSchema }),
  async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { card_type, pet_id, platform, invite_code } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO share_records (user_id, card_type, pet_id, platform, invite_code)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [userId, card_type, pet_id || null, platform || 'wechat', invite_code || null],
      );
      res.json({
        id: String(result.rows[0].id),
        userId,
        cardType: card_type,
        petId: pet_id || null,
        sharedAt: result.rows[0].created_at.toISOString(),
        platform: platform || 'wechat',
        inviteCode: invite_code || '',
      });
    } catch (error) {
      console.error('[Invite] 记录分享失败:', sanitizeError(error));
      res.status(500).json({ success: false, message: '记录分享失败' });
    }
  },
);

/** GET /api/referrals - 当前用户的推荐记录 */
router.get('/referrals', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const { rows } = await pool.query(
      `SELECT id, inviter_id, invitee_id, invite_code, reward_granted, created_at
       FROM referral_records WHERE inviter_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    res.json(rows.map(r => ({
      id: String(r.id),
      inviterId: r.inviter_id,
      inviteeId: r.invitee_id,
      inviteCode: r.invite_code,
      registeredAt: r.created_at.toISOString(),
      rewardGranted: r.reward_granted,
    })));
  } catch (error) {
    console.error('[Invite] 获取推荐记录失败:', sanitizeError(error));
    res.status(500).json({ success: false, message: '获取推荐记录失败' });
  }
});

/** POST /api/referrals/process - 新用户使用邀请码后建立推荐关系 */
router.post(
  '/referrals/process',
  authMiddleware,
  validate({ body: processReferralSchema }),
  async (req: Request, res: Response) => {
    const { invite_code } = req.body;
    try {
      // 2026-09 审查 P0 修复：被邀请人一律取登录态用户（req.userId），绝不信任请求体 invitee_id。
      // 原实现取 body.invitee_id：任意登录用户可代任意真实用户建立推荐关系（抢占其唯一名额
      // UNIQUE(invitee_id)），配合小号注册→注销（FK CASCADE 删 referral 记录）可无限刷 7 天会员奖励。
      // 注意：本接口的语义就是「新用户自己提交邀请码」，登录态即被邀请人。
      const invitee_id = req.userId!;

      const found = await pool.query(`SELECT user_id FROM invite_codes WHERE code = $1`, [invite_code]);
      if (found.rows.length === 0) {
        res.json({ success: false, error: '邀请码无效' });
        return;
      }
      const inviterId = found.rows[0].user_id as string;
      if (inviterId === invitee_id) {
        res.json({ success: false, error: '不能邀请自己' });
        return;
      }
      // 同一被邀请人只记一条（UNIQUE 约束兜底）
      await pool.query(
        `INSERT INTO referral_records (inviter_id, invitee_id, invite_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (invitee_id) DO NOTHING`,
        [inviterId, invitee_id, invite_code],
      );
      res.json({ success: true });
    } catch (error) {
      console.error('[Invite] 处理推荐关系失败:', sanitizeError(error));
      res.status(500).json({ success: false, message: '处理推荐关系失败' });
    }
  },
);

/** POST /api/shares/grant-reward - 邀请达标后发放会员天数奖励 */
router.post('/shares/grant-reward', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    // 统计未发放奖励的推荐记录
    const ungranted = await pool.query(
      `SELECT id FROM referral_records WHERE inviter_id = $1 AND reward_granted = false`,
      [userId],
    );
    if (ungranted.rows.length < SHARE_REWARD_INVITES) {
      // message 与 error 同时给：客户端 api 层用 `body.message` 构造 Error
      // （见 miniapp/src/services/api.ts 的 request()），只给 error 的话
      // 前端只能拿到兜底的"请求失败"，"还需邀请 N 位"这句唯一的可读文案会丢
      res.json({
        success: false,
        message: `还需邀请 ${SHARE_REWARD_INVITES - ungranted.rows.length} 位好友即可获得奖励`,
        error: `还需邀请 ${SHARE_REWARD_INVITES - ungranted.rows.length} 位好友即可获得奖励`,
      });
      return;
    }

    const now = new Date();
    const membership = await pool.query(
      `SELECT id, expires_at, status FROM memberships WHERE user_id = $1`,
      [userId],
    );
    // 会员有效期内顺延，否则从现在起算
    const current = membership.rows.length > 0 && membership.rows[0].status === 'active'
      ? (membership.rows[0].expires_at ? new Date(membership.rows[0].expires_at) : null)
      : null;
    const newExpiresAt = computeNewExpiresAt(current, now, REWARD_DAYS);

    if (membership.rows.length > 0) {
      await pool.query(
        `UPDATE memberships SET tier = 'member', status = 'active', expires_at = $1 WHERE user_id = $2`,
        [newExpiresAt.toISOString(), userId],
      );
    } else {
      await pool.query(
        `INSERT INTO memberships (user_id, tier, status, expires_at, started_at)
         VALUES ($1, 'member', 'active', $2, now())`,
        [userId, newExpiresAt.toISOString()],
      );
    }

    // 发放后标记已发奖，避免重复领取
    await pool.query(
      `UPDATE referral_records SET reward_granted = true WHERE inviter_id = $1 AND reward_granted = false`,
      [userId],
    );
    res.json({ success: true, rewardType: 'membership_days', rewardValue: REWARD_DAYS });
  } catch (error) {
    console.error('[Invite] 发放奖励失败:', sanitizeError(error));
    res.status(500).json({ success: false, message: '奖励发放失败' });
  }
});

export default router;