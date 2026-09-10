/**
 * 宠物档案数据访问层 - pet_profiles 表
 * 统一宠物归属校验（消除 9 处重复 verifyPetOwnership）、宠物信息查询
 * 继承 BaseRepository，复用通用 CRUD 能力，强制参数化查询防注入
 */
import { BaseRepository } from './baseRepository.js';
import type { QueryResultRow } from 'pg';

/** 宠物档案数据行（完整字段） */
export interface PetRow extends QueryResultRow {
  id: string;
  user_id: string;
  name: string;
  species: string;
  breed: string;
  breed_id: string | null;
  gender: string | null;
  birth_date: string | null;
  weight: number | null;
  avatar_photo_url: string | null;
  avatar_cartoon_url: string | null;
  /** 全方位角色设定图（迁移 030）：四视图全身参考图，全家福/回忆录参考优先级仅次于真实照片 */
  avatar_multiview_url: string | null;
  avatar_style: string | null;
  photos: string[];
  is_neutered: boolean;
  microchip_id: string;
  notes: string;
  is_deceased: boolean;
  deceased_date: string | null;
  created_at: string;
  updated_at: string;
}

/** 宠物名称与头像（响应构建用，避免返回完整档案） */
export interface PetNameAvatar {
  name: string;
  avatar_url: string | null;
}

/** 创建宠物参数 */
export interface CreatePetParams {
  id: string;
  user_id: string;
  name: string;
  species: string;
  breed: string;
  breed_id: string | null;
  gender: string | null;
  birth_date: string | null;
  weight: number;
  avatar_photo_url: string | null;
  avatar_cartoon_url: string | null;
  avatar_style: string | null;
  photos: string[];
  is_neutered: boolean;
  microchip_id: string;
  notes: string;
}

/**
 * 宠物档案仓库 - pet_profiles 表
 * 提供统一的归属校验能力，消除各 service/route 中重复的 verifyPetOwnership
 */
export class PetRepository extends BaseRepository<PetRow> {
  protected tableName = 'pet_profiles';
  protected allowedSortFields = ['created_at', 'updated_at', 'name'] as const;

  /**
   * 校验宠物归属权（用于权限校验）
   * 使用 findOneWhere 而非 countWhere，避免 COUNT 聚合开销
   * 兼容 mock 契约：rowCount > 0 即视为归属通过
   */
  async isOwner(petId: string, userId: string): Promise<boolean> {
    const row = await this.findOneWhere('id = $1 AND user_id = $2', [petId, userId]);
    return row !== null;
  }

  /**
   * 校验宠物访问权（多成员共同养宠，2026-08-24）
   * ① 宠物主人（pet_profiles.user_id）→ 完全权限
   * ② 家庭成员：宠物所在家庭（pet_family_members）里，我是成员（pet_family_users）
   * ③ 其他 → 无权限
   * 用于打卡/疫苗/症状/回忆等"成员可操作"的路由归属校验；
   * 删除宠物等"仅主人"操作仍用 isOwner。
   */
  async canAccess(petId: string, userId: string): Promise<boolean> {
    const result = await this.rawQuery<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pet_profiles p WHERE p.id = $1 AND p.user_id = $2
         UNION ALL
         SELECT 1 FROM pet_family_members m
         JOIN pet_family_users u ON u.family_id = m.family_id
         WHERE m.pet_id = $1 AND u.user_id = $2
       ) AS ok`,
      [petId, userId],
    );
    return result.rows[0]?.ok ?? false;
  }

  /**
   * 查询用户可访问的宠物 ID 列表（本人创建 + 家庭成员共享）
   * 家庭成员视角：用于"我共管的宠物"接口与首页宠物列表聚合
   */
  async findAccessiblePetIds(userId: string): Promise<string[]> {
    const result = await this.rawQuery<{ id: string }>(
      `SELECT DISTINCT p.id
       FROM pet_profiles p
       LEFT JOIN pet_family_members m ON m.pet_id = p.id
       LEFT JOIN pet_family_users u ON u.family_id = m.family_id AND u.user_id = $1
       WHERE p.user_id = $1 OR u.user_id = $1
       ORDER BY p.id`,
      [userId],
    );
    return result.rows.map((r) => r.id);
  }

  /**
   * 按 ID + 用户 ID 查询宠物（带归属校验）
   */
  async findByIdAndUser(petId: string, userId: string): Promise<PetRow | null> {
    return this.findOneWhere('id = $1 AND user_id = $2', [petId, userId]);
  }

  /**
   * 批量查询"该用户可访问的宠物"（多宠共同回忆用，2026-09-11 新增）
   *
   * 【为什么要有它】创建回忆时最多允许关联 10 只宠物，
   * 逐个 canAccess 要打 10 次库；这里一次查回来，既能判归属（少了的即无权限），
   * 又能顺便取到**服务端权威的名字/物种**（避免信任客户端传来的名字）。
   * 口径与 canAccess/findAccessiblePetIds 一致：本人创建 + 家庭成员共享的宠物都算可访问。
   *
   * @param petIds - 待校验的宠物 ID（调用方已去重）
   * @param userId - 当前登录用户
   * @returns 命中的宠物行（含 name/species），未命中的即无权限
   */
  async findAccessibleByIds(
    petIds: string[],
    userId: string,
  ): Promise<Array<{ id: string; name: string; species: string | null }>> {
    if (!petIds.length) return [];
    const result = await this.rawQuery<{ id: string; name: string; species: string | null }>(
      `SELECT DISTINCT p.id, p.name, p.species
       FROM pet_profiles p
       LEFT JOIN pet_family_members m ON m.pet_id = p.id
       LEFT JOIN pet_family_users u ON u.family_id = m.family_id AND u.user_id = $2
       WHERE p.id = ANY($1::text[]) AND (p.user_id = $2 OR u.user_id = $2)`,
      [petIds, userId],
    );
    return result.rows;
  }

  /**
   * 查询用户所有宠物（按创建时间倒序）
   */
  async findAllByUser(userId: string): Promise<PetRow[]> {
    const result = await this.rawQuery<PetRow>(
      `SELECT * FROM ${this.tableName}
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  /**
   * 创建宠物档案
   */
  async createPet(params: CreatePetParams): Promise<PetRow> {
    const result = await this.rawQuery<PetRow>(
      `INSERT INTO ${this.tableName}
        (id, user_id, name, species, breed, breed_id, gender, birth_date, weight,
         avatar_photo_url, avatar_cartoon_url, avatar_style, photos,
         is_neutered, microchip_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        params.id, params.user_id, params.name, params.species, params.breed,
        params.breed_id, params.gender, params.birth_date, params.weight,
        params.avatar_photo_url, params.avatar_cartoon_url, params.avatar_style,
        params.photos, params.is_neutered, params.microchip_id, params.notes,
      ],
    );
    return result.rows[0];
  }

  /**
   * 按 ID + 用户 ID 更新宠物（带归属校验，动态字段）
   * 字段名来自白名单 fieldMap（非用户输入），可直接拼入 SET 子句
   */
  async updateByIdAndUser(
    petId: string,
    userId: string,
    data: Partial<Omit<PetRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>>,
  ): Promise<PetRow | null> {
    const allowedFields: readonly string[] = [
      'name', 'species', 'breed', 'breed_id', 'gender', 'birth_date', 'weight',
      'avatar_photo_url', 'avatar_cartoon_url', 'avatar_multiview_url', 'avatar_style', 'photos',
      'is_neutered', 'microchip_id', 'notes',
    ];

    const keys = Object.keys(data).filter((k) => allowedFields.includes(k));
    if (keys.length === 0) return null;

    const setClauses = keys.map((key, i) => `${key} = $${i + 1}`);
    const values = keys.map((k) => data[k as keyof typeof data]);

    setClauses.push(`updated_at = NOW()`);
    values.push(petId, userId);

    const result = await this.rawQuery<PetRow>(
      `UPDATE ${this.tableName} SET ${setClauses.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  }

  /**
   * 按 ID + 用户 ID 删除宠物（带归属校验）
   */
  async deleteByIdAndUser(petId: string, userId: string): Promise<boolean> {
    const result = await this.rawQuery(
      `DELETE FROM ${this.tableName} WHERE id = $1 AND user_id = $2`,
      [petId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * 标记宠物离世（带归属校验）
   */
  async markDeceased(petId: string, userId: string, deceasedDate: string): Promise<PetRow | null> {
    const result = await this.rawQuery<PetRow>(
      `UPDATE ${this.tableName}
       SET is_deceased = true, deceased_date = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [deceasedDate, petId, userId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * 查询宠物名称和头像（用于响应构建，避免泄露完整档案）
   * avatar_photo_url 优先于 avatar_cartoon_url
   */
  async findNameAndAvatar(petId: string): Promise<PetNameAvatar | null> {
    const result = await this.rawQuery<PetNameAvatar>(
      `SELECT name, avatar_photo_url AS avatar_url
       FROM ${this.tableName}
       WHERE id = $1`,
      [petId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * 校验宠物是否属于指定家庭（用于家庭角色分配等场景）
   * 跨表检查 pet_family_members，使用参数化查询
   */
  async existsInFamily(petId: string, familyId: string): Promise<boolean> {
    const result = await this.rawQuery(
      `SELECT 1 FROM pet_family_members
       WHERE family_id = $1 AND pet_id = $2
       LIMIT 1`,
      [familyId, petId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * 查询宠物当前体重（用于趋势报告对比）
   * 仅返回 weight 字段，避免泄露完整档案
   */
  async findWeightByIdAndUser(petId: string, userId: string): Promise<number | null> {
    const result = await this.rawQuery<{ weight: string | null }>(
      `SELECT weight FROM ${this.tableName}
       WHERE id = $1 AND user_id = $2`,
      [petId, userId],
    );
    const weight = result.rows[0]?.weight;
    return weight ? parseFloat(weight) : null;
  }

  /**
   * 查询用户的第一只宠物（按创建时间正序，用于 AI 对话默认宠物）
   * 返回 id、name、breed 三个字段
   */
  async findFirstByUser(userId: string): Promise<{ id: string; name: string; breed: string } | null> {
    const result = await this.rawQuery<{ id: string; name: string; breed: string }>(
      `SELECT id, name, breed FROM ${this.tableName}
       WHERE user_id = $1
       ORDER BY created_at
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * 更新宠物 AI 生成头像（avatar_cartoon_url + avatar_style + avatar_generated_at）
   * 不带归属校验，调用方需先调用 isOwner 校验（避免重复查询）
   */
  async updateAvatarGenerated(
    petId: string,
    avatarCartoonUrl: string,
    avatarStyle: string,
  ): Promise<void> {
    await this.rawQuery(
      `UPDATE ${this.tableName}
       SET avatar_cartoon_url = $1, avatar_style = $2, avatar_generated_at = now()
       WHERE id = $3`,
      [avatarCartoonUrl, avatarStyle, petId],
    );
  }
}
