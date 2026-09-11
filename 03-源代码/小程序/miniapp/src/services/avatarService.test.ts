/**
 * 头像服务测试（外部测试文件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  getPhotoGenerationCount,
  canGeneratePhoto,
  incrementPhotoGenerationCount,
  getPhotoOptionsCount,
  canGeneratePhotoOptions,
  incrementPhotoOptionsCount,
  get3DGenerationCount,
  canGenerate3D,
  increment3DGenerationCount,
  getAvatarCustomization,
  saveAvatarCustomization,
  setPetPhotoAsAvatar,
} from './avatarService';
import { api } from './api';
import { AVATAR_PHOTO_FREE_COUNT, AVATAR_PHOTO_MEMBER_MONTHLY_LIMIT, AVATAR_3D_MONTHLY_LIMIT } from '../constants';

// 使用 vi.hoisted 确保 mock 对象在 vi.mock 工厂执行时可用
// 工厂内局部变量改名（eventCenterStub / taroStub）：与解构出的外层同名会触发 no-shadow
const { mockTaro, eventCenter } = vi.hoisted(() => {
  const eventCenterStub = { on: vi.fn(), off: vi.fn(), trigger: vi.fn() };
  const taroStub = {
    getStorageSync: vi.fn(),
    setStorageSync: vi.fn(),
    showToast: vi.fn(),
    showModal: vi.fn(),
    navigateTo: vi.fn(),
    navigateBack: vi.fn(),
    switchTab: vi.fn(),
    eventCenter: eventCenterStub,
  };
  return { mockTaro: taroStub, eventCenter: eventCenterStub };
});

vi.mock('@tarojs/taro', () => ({
  default: mockTaro,
  eventCenter,
}));

// 模拟依赖模块
vi.mock('../engines/petAvatar/svgRenderer', () => ({
  getPetFaceDataUri: vi.fn(() => 'data:image/svg+xml,mock'),
}));

vi.mock('../engines/petAvatar/expressionEngine', () => ({
  calculateExpression: vi.fn(() => ({ expression: 'happy', accessories: [] })),
}));

vi.mock('../engines/petAvatar/diaryEngine', () => ({
  generateDiaryForToday: vi.fn(() => 'mock diary'),
}));

vi.mock('../engines/petAvatar/seedreamAdapter', () => ({
  seedreamAdapter: {
    generatePetImage: vi.fn(),
  },
}));

vi.mock('./api', () => ({
  api: {
    upload: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  // 与真实 resolveAvatarUrl 行为一致：相对路径补全为绝对地址
  resolveAvatarUrl: (url: string) => (url.startsWith('http') ? url : `https://api.example.com${url}`),
}));

vi.mock('../config', () => ({
  CONFIG: {
    apiBaseUrl: 'https://mock-api.example.com',
    API_BASE_URL: 'https://mock-api.example.com',
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockTaro.getStorageSync.mockReturnValue(0);
  mockTaro.setStorageSync.mockImplementation(() => {});
});

describe('avatarService - 配额管理（前端缓存）', () => {
  describe('getPhotoGenerationCount', () => {
    it('未存储时应返回 0', () => {
      mockTaro.getStorageSync.mockReturnValue(null);
      expect(getPhotoGenerationCount()).toBe(0);
    });

    it('存储为数字时应返回对应值', () => {
      mockTaro.getStorageSync.mockReturnValue(3);
      expect(getPhotoGenerationCount()).toBe(3);
    });

    it('存储为非数字时应返回 0', () => {
      mockTaro.getStorageSync.mockReturnValue('invalid');
      expect(getPhotoGenerationCount()).toBe(0);
    });
  });

  describe('canGeneratePhoto', () => {
    it('非会员应始终返回 false（照片生成会员专享）', () => {
      mockTaro.getStorageSync.mockReturnValue(0);
      expect(canGeneratePhoto(false)).toBe(false);
    });

    it('会员未达上限应返回 true', () => {
      mockTaro.getStorageSync.mockReturnValue(0);
      expect(canGeneratePhoto(true)).toBe(true);
    });

    it('会员达到上限应返回 false', () => {
      mockTaro.getStorageSync.mockReturnValue(AVATAR_PHOTO_FREE_COUNT);
      expect(canGeneratePhoto(true)).toBe(false);
    });

    it('会员超过上限应返回 false', () => {
      mockTaro.getStorageSync.mockReturnValue(AVATAR_PHOTO_FREE_COUNT + 5);
      expect(canGeneratePhoto(true)).toBe(false);
    });
  });

  describe('照片专属多风格头像配额（会员每月 3 次）', () => {
    it('getPhotoOptionsCount 未存储时应返回 0', () => {
      mockTaro.getStorageSync.mockReturnValue(null);
      expect(getPhotoOptionsCount()).toBe(0);
    });

    it('非会员不可生成照片专属头像', () => {
      expect(canGeneratePhotoOptions(false)).toBe(false);
    });

    it('会员未达上限应返回 true', () => {
      mockTaro.getStorageSync.mockReturnValue(0);
      expect(canGeneratePhotoOptions(true)).toBe(true);
    });

    it('会员达到每月上限应返回 false', () => {
      mockTaro.getStorageSync.mockReturnValue(AVATAR_PHOTO_MEMBER_MONTHLY_LIMIT);
      expect(canGeneratePhotoOptions(true)).toBe(false);
    });

    it('生成成功后计数 +1', () => {
      mockTaro.getStorageSync.mockReturnValue(2);
      incrementPhotoOptionsCount();
      expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_photo_options_count', 3);
    });
  });

  describe('incrementPhotoGenerationCount', () => {
    it('应将计数+1 并写入存储', () => {
      mockTaro.getStorageSync.mockReturnValue(2);
      incrementPhotoGenerationCount();
      expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_photo_count', 3);
    });

    it('未存储时应从 0 开始+1', () => {
      mockTaro.getStorageSync.mockReturnValue(null);
      incrementPhotoGenerationCount();
      expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_photo_count', 1);
    });
  });
});

describe('avatarService - 3D 配额（按月重置）', () => {
  const currentMonth = new Date().toISOString().slice(0, 7);

  describe('get3DGenerationCount', () => {
    it('月份不匹配时应重置为 0', () => {
      mockTaro.getStorageSync.mockImplementation((key: string) => {
        if (key === 'xhh_avatar_3d_count_date') return '2020-01';
        if (key === 'xhh_avatar_3d_count') return 5;
        return null;
      });

      const count = get3DGenerationCount();

      expect(count).toBe(0);
      expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_3d_count', 0);
      expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_3d_count_date', currentMonth);
    });

    it('月份匹配时应返回已存储的计数', () => {
      mockTaro.getStorageSync.mockImplementation((key: string) => {
        if (key === 'xhh_avatar_3d_count_date') return currentMonth;
        if (key === 'xhh_avatar_3d_count') return 2;
        return null;
      });

      expect(get3DGenerationCount()).toBe(2);
    });
  });

  describe('canGenerate3D', () => {
    it('非会员应始终返回 false（3D 为会员专享）', () => {
      mockTaro.getStorageSync.mockImplementation((key: string) => {
        if (key === 'xhh_avatar_3d_count_date') return currentMonth;
        if (key === 'xhh_avatar_3d_count') return 0;
        return null;
      });

      expect(canGenerate3D(false)).toBe(false);
    });

    it('会员未达上限应返回 true', () => {
      mockTaro.getStorageSync.mockImplementation((key: string) => {
        if (key === 'xhh_avatar_3d_count_date') return currentMonth;
        if (key === 'xhh_avatar_3d_count') return 1;
        return null;
      });

      expect(canGenerate3D(true)).toBe(true);
    });

    it('会员达到上限应返回 false', () => {
      mockTaro.getStorageSync.mockImplementation((key: string) => {
        if (key === 'xhh_avatar_3d_count_date') return currentMonth;
        if (key === 'xhh_avatar_3d_count') return AVATAR_3D_MONTHLY_LIMIT;
        return null;
      });

      expect(canGenerate3D(true)).toBe(false);
    });
  });

  describe('increment3DGenerationCount', () => {
    it('应将计数+1 并写入存储', () => {
      mockTaro.getStorageSync.mockImplementation((key: string) => {
        if (key === 'xhh_avatar_3d_count_date') return currentMonth;
        if (key === 'xhh_avatar_3d_count') return 1;
        return null;
      });

      increment3DGenerationCount();

      expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_3d_count', 2);
    });
  });
});

describe('avatarService - 配额一致性验证', () => {
  it('AVATAR_PHOTO_FREE_COUNT 应为 1（会员每月 1 次 2D 形象包）', () => {
    expect(AVATAR_PHOTO_FREE_COUNT).toBe(1);
  });

  it('AVATAR_PHOTO_MEMBER_MONTHLY_LIMIT 应为 3（会员每月 3 次照片专属头像）', () => {
    expect(AVATAR_PHOTO_MEMBER_MONTHLY_LIMIT).toBe(3);
  });

  it('AVATAR_3D_MONTHLY_LIMIT 应为 3（会员每月 3 次 3D）', () => {
    expect(AVATAR_3D_MONTHLY_LIMIT).toBe(3);
  });
});

describe('avatarService - 头像定制缓存（按宠物隔离）', () => {
  it('无 petId 时写入历史全局 key（兼容老版本）', async () => {
    const custom = { species: 'dog' as const, style: 'cartoon' as const, baseColor: '#FFD93D' };
    await saveAvatarCustomization(custom);
    expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_custom', custom);
  });

  it('传入 petId 时按宠物隔离存储，多宠物互不覆盖', async () => {
    const customA = { species: 'dog' as const, style: 'cartoon' as const, baseColor: '#FFD93D' };
    const customB = { species: 'cat' as const, style: 'cartoon' as const, baseColor: '#6BCB77' };
    await saveAvatarCustomization(customA, 'pet-a');
    await saveAvatarCustomization(customB, 'pet-b');
    expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_custom_pet-a', customA);
    expect(mockTaro.setStorageSync).toHaveBeenCalledWith('xhh_avatar_custom_pet-b', customB);
  });

  it('saveAvatarCustomization 同步服务端 snake_case 契约并清空 avatar_photo_url', async () => {
    (api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'pet-1' });
    const custom = { species: 'dog' as const, style: 'realistic' as const, baseColor: '#4D96FF', cartoonUrl: 'https://cdn.example.com/a.png', generatedAt: '2026-08-08T00:00:00.000Z' };
    await saveAvatarCustomization(custom, 'pet-1');
    // 服务端 PUT /api/pets/:id 只认 snake_case（zod 剥离 camelCase 键）；
    // avatar_photo_url 置 null 避免"设过照片后保存卡通形象不显示"（展示优先级 photo > cartoon）
    expect(api.put).toHaveBeenCalledWith('/api/pets/pet-1', {
      avatar_style: 'realistic',
      avatar_cartoon_url: 'https://cdn.example.com/a.png',
      avatar_photo_url: null,
    });
  });

  it('getAvatarCustomization(petId) 读取对应宠物的缓存', () => {
    const custom = { species: 'cat' as const, style: 'realistic' as const, baseColor: '#4D96FF' };
    mockTaro.getStorageSync.mockImplementation((key: string) => (key === 'xhh_avatar_custom_pet-1' ? custom : null));
    expect(getAvatarCustomization('pet-1')).toEqual(custom);
  });

  it('getAvatarCustomization(petId) 新 key 不存在时回退历史全局 key', () => {
    const legacy = { species: 'dog' as const, style: 'cartoon' as const, baseColor: '#FFD93D' };
    mockTaro.getStorageSync.mockImplementation((key: string) => (key === 'xhh_avatar_custom' ? legacy : null));
    expect(getAvatarCustomization('pet-1')).toEqual(legacy);
  });
});

describe('avatarService - setPetPhotoAsAvatar（照片直接设为头像）', () => {
  it('相对路径上传结果应补全为绝对地址并同步服务端 avatar_photo_url（snake_case）', async () => {
    mockTaro.getStorageSync.mockReturnValue(null);
    (api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'pet-1', avatarPhotoUrl: 'https://api.example.com/uploads/pet-photos/u/pet-1/a.jpg' });

    const result = await setPetPhotoAsAvatar('pet-1', '/uploads/pet-photos/u/pet-1/a.jpg');

    expect(result.success).toBe(true);
    expect(result.pet?.avatarPhotoUrl).toBe('https://api.example.com/uploads/pet-photos/u/pet-1/a.jpg');
    // 本地缓存按宠物 key 记录，并保存补全后的绝对地址
    expect(mockTaro.setStorageSync).toHaveBeenCalledWith(
      'xhh_avatar_custom_pet-1',
      expect.objectContaining({ cartoonUrl: 'https://api.example.com/uploads/pet-photos/u/pet-1/a.jpg' }),
    );
    expect(api.put).toHaveBeenCalledWith('/api/pets/pet-1', {
      avatar_photo_url: 'https://api.example.com/uploads/pet-photos/u/pet-1/a.jpg',
    });
  });

  it('已上传的照片（绝对地址）不应被二次拼接', async () => {
    mockTaro.getStorageSync.mockReturnValue(null);
    (api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'pet-1' });

    const result = await setPetPhotoAsAvatar('pet-1', 'https://cdn.example.com/photo.jpg');

    expect(result.success).toBe(true);
    expect(api.put).toHaveBeenCalledWith('/api/pets/pet-1', {
      avatar_photo_url: 'https://cdn.example.com/photo.jpg',
    });
  });

  it('服务端更新失败时本地缓存仍生效（离线兜底）', async () => {
    mockTaro.getStorageSync.mockReturnValue(null);
    (api.put as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));

    const result = await setPetPhotoAsAvatar('pet-1', '/uploads/pet-photos/u/pet-1/a.jpg');

    expect(result.success).toBe(true);
    expect(mockTaro.setStorageSync).toHaveBeenCalledWith(
      'xhh_avatar_custom_pet-1',
      expect.objectContaining({ cartoonUrl: 'https://api.example.com/uploads/pet-photos/u/pet-1/a.jpg' }),
    );
  });
});
