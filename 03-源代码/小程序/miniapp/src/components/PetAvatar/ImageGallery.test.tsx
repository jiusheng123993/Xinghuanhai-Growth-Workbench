/**
 * 宠物形象画廊组件测试
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageGallery from './ImageGallery';
import { AVATAR_EXPRESSIONS, AVATAR_ACTIONS, AVATAR_ANGLES, AVATAR_ACTION_ANGLES } from '../../constants';
import type { Avatar2DImage, AvatarAngle, AvatarExpression, AvatarAction } from '../../types/avatarTypes';

function makeImages(items: Array<{ key: AvatarExpression | AvatarAction; angle: AvatarAngle }>): Avatar2DImage[] {
  return items.map((item, idx) => ({
    id: `img-${idx}`,
    angle: item.angle,
    expression: item.key,
    imageUrl: `https://example.com/${item.key}-${item.angle}.jpg`,
    isSelected: false,
    sortOrder: idx,
  }));
}

describe('ImageGallery 组件', () => {
  describe('默认渲染（表情 Tab）', () => {
    it('应渲染所有 6 个角度选项', () => {
      const images = makeImages([
        { key: 'happy', angle: 'front' },
      ]);
      render(<ImageGallery images={images} />);

      // 默认是表情 Tab，应显示全部 6 角度
      for (const angle of AVATAR_ANGLES) {
        expect(screen.getByText(angle.label)).toBeTruthy();
      }
    });

    it('应渲染表情选择器', () => {
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(<ImageGallery images={images} />);

      // 表情 Tab 应显示表情列表
      for (const expr of AVATAR_EXPRESSIONS) {
        expect(screen.getByText(expr.label)).toBeTruthy();
      }
    });

    it('应显示匹配的预览图', () => {
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(<ImageGallery images={images} />);

      // 默认选中 front + happy，应显示对应图片
      const img = screen.getByRole('img');
      expect(img.getAttribute('src')).toBe('https://example.com/happy-front.jpg');
    });

    it('无匹配图片时应显示"暂无形象图"', () => {
      const images: Avatar2DImage[] = [];
      render(<ImageGallery images={images} />);

      expect(screen.getByText('暂无形象图')).toBeTruthy();
    });
  });

  describe('动作 Tab 切换', () => {
    it('切换到动作 Tab 应只显示 3 个角度（动作子集）', () => {
      const images = makeImages([{ key: 'sit', angle: 'front' }]);
      render(<ImageGallery images={images} />);

      // 点击"动作" Tab
      fireEvent.click(screen.getByText('动作'));

      // 动作 Tab 应只显示 AVATAR_ACTION_ANGLES（前 3 个角度）
      for (const angle of AVATAR_ACTION_ANGLES) {
        expect(screen.getByText(angle.label)).toBeTruthy();
      }
      // 不应显示第 4 个角度
      expect(screen.queryByText(AVATAR_ANGLES[3].label)).toBeNull();
    });

    it('切换到动作 Tab 应显示动作选择器', () => {
      const images = makeImages([{ key: 'sit', angle: 'front' }]);
      render(<ImageGallery images={images} />);

      fireEvent.click(screen.getByText('动作'));

      // 动作 Tab 应显示动作列表
      for (const action of AVATAR_ACTIONS) {
        expect(screen.getByText(action.label)).toBeTruthy();
      }
    });

    it('切换 Tab 后选中状态应重置', () => {
      const images = makeImages([
        { key: 'happy', angle: 'front' },
        { key: 'sit', angle: 'front' },
      ]);
      render(<ImageGallery images={images} />);

      // 默认表情 Tab，选中 happy
      expect(screen.getByRole('img').getAttribute('src')).toContain('happy');

      // 切到动作 Tab
      fireEvent.click(screen.getByText('动作'));
      // 应重置为第一个动作 sit
      expect(screen.getByRole('img').getAttribute('src')).toContain('sit');
    });
  });

  describe('操作按钮', () => {
    it('默认（show3DEntry 缺省）应隐藏 3D 入口——2026-08-22 决定上线首版关闭 3D', () => {
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(<ImageGallery images={images} canGenerate3D />);

      expect(screen.getByText('保存为头像')).toBeTruthy();
      expect(screen.queryByText('生成 3D 模型')).toBeNull();
      expect(screen.queryByText('会员专享')).toBeNull();
    });

    it('show3DEntry=true 时应显示"保存为头像"和"生成 3D 模型"按钮', () => {
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(<ImageGallery images={images} show3DEntry canGenerate3D />);

      expect(screen.getByText('保存为头像')).toBeTruthy();
      expect(screen.getByText('生成 3D 模型')).toBeTruthy();
    });

    it('无图片时不应显示操作按钮', () => {
      const images: Avatar2DImage[] = [];
      render(<ImageGallery images={images} />);

      expect(screen.queryByText('保存为头像')).toBeNull();
      expect(screen.queryByText('生成 3D 模型')).toBeNull();
    });

    it('canGenerate3D=false 时按钮应显示"会员专享"', () => {
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(<ImageGallery images={images} show3DEntry canGenerate3D={false} />);

      expect(screen.getByText('会员专享')).toBeTruthy();
    });

    it('isGenerating3D=true 时按钮应显示"生成中..."', () => {
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(
        <ImageGallery
          images={images}
          show3DEntry
          isGenerating3D
          canGenerate3D
        />,
      );

      expect(screen.getByText('生成中...')).toBeTruthy();
    });

    it('点击"保存为头像"应调用 onSaveAsAvatar', () => {
      const onSaveAsAvatar = vi.fn();
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(<ImageGallery images={images} onSaveAsAvatar={onSaveAsAvatar} />);

      fireEvent.click(screen.getByText('保存为头像'));
      expect(onSaveAsAvatar).toHaveBeenCalledTimes(1);
      expect(onSaveAsAvatar.mock.calls[0][0].expression).toBe('happy');
      expect(onSaveAsAvatar.mock.calls[0][0].angle).toBe('front');
    });

    it('点击"生成 3D 模型"应调用 onGenerate3D（即使 canGenerate3D=false，由父组件处理引导）', () => {
      const onGenerate3D = vi.fn();
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(
        <ImageGallery
          images={images}
          show3DEntry
          onGenerate3D={onGenerate3D}
          canGenerate3D={false}
        />
      );

      fireEvent.click(screen.getByText('会员专享'));
      expect(onGenerate3D).toHaveBeenCalledTimes(1);
    });

    it('isGenerating3D=true 时点击按钮不应调用 onGenerate3D', () => {
      const onGenerate3D = vi.fn();
      const images = makeImages([{ key: 'happy', angle: 'front' }]);
      render(
        <ImageGallery
          images={images}
          show3DEntry
          onGenerate3D={onGenerate3D}
          isGenerating3D
          canGenerate3D
        />
      );

      fireEvent.click(screen.getByText('生成中...'));
      expect(onGenerate3D).not.toHaveBeenCalled();
    });
  });
});
