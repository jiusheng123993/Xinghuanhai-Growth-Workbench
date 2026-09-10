/**
 * 宠物信息卡片组件
 * 展示宠物的头像、名称、品种、年龄、体重等信息，支持点击和长按操作
 */
import { View, Text, Image } from '@tarojs/components';
import type { PetProfile } from '../services/petService';
import { formatPetAge } from '../utils/date';
import './PetCard.scss';

interface PetCardProps {
  pet: PetProfile;
  isCurrent?: boolean;
  onClick?: (pet: PetProfile) => void;
  onLongPress?: (pet: PetProfile) => void;
}

/**
 * 年龄文案已收敛到 utils/date 的 formatPetAge（2026-09-11）
 *
 * 这里原本有一份局部实现，缺陷有三个：
 *  ① **跨年分支**只按月相减、不减「日」（`years > 0` 时直接拼 `${years}岁${months}个月`）：
 *     生日 2025-09-20 的宠物在 2026-09-11 会显示「1岁」，而创作页/形象定制页显示「11个月」；
 *     （不足岁那个分支其实减了日，所以本质是"两个分支口径不一致"，不只是"忘了减"。）
 *  ② 不足一个月时用 `new Date('YYYY-MM-DD')`（按 UTC 解析，东八区=当天 08:00）算天数；
 *  ③ 出生日期为空时 `new Date('')` → NaN，会渲染出「NaN天」，现在走兜底不显示。
 * 全站 11 处各写各的实现现已统一，规则与"有意保留的异口径"清单见 formatPetAge 的注释。
 */
const getDefaultAvatar = (species: 'dog' | 'cat'): string => {
  return species === 'dog' ? '🐕' : '🐱';
};

const PetCard: React.FC<PetCardProps> = ({ pet, isCurrent = false, onClick, onLongPress }) => {
  const handleClick = () => {
    onClick?.(pet);
  };

  const handleLongPress = () => {
    onLongPress?.(pet);
  };

  const age = formatPetAge(pet.birthDate);
  const defaultAvatar = getDefaultAvatar(pet.species);

  return (
    <View
      className={`pet-card ${isCurrent ? 'pet-card--current' : ''} ${pet.isDeceased ? 'pet-card--deceased' : ''}`}
      onClick={handleClick}
      onLongPress={handleLongPress}
    >
      <View className='pet-card__avatar'>
        {pet.avatarPhotoUrl || pet.avatarCartoonUrl ? (
          <Image
            className='pet-card__avatar-img'
            src={pet.avatarPhotoUrl || pet.avatarCartoonUrl!}
            mode='aspectFill'
            lazyLoad
          />
        ) : (
          <Text className='pet-card__avatar-emoji'>{defaultAvatar}</Text>
        )}
      </View>

      <View className='pet-card__info'>
        <View className='pet-card__name-row'>
          <Text className='pet-card__name'>{pet.name}</Text>
          <Text
            className={`pet-card__gender ${pet.gender === 'male' ? 'pet-card__gender--male' : 'pet-card__gender--female'}`}
          >
            {pet.gender === 'male' ? '♂️' : '♀️'}
          </Text>
          {isCurrent && (
            <View className='pet-card__tag pet-card__tag--current'>
              <Text className='pet-card__tag-text'>当前</Text>
            </View>
          )}
          {pet.isDeceased && (
            <View className='pet-card__tag pet-card__tag--deceased'>
              <Text className='pet-card__tag-text'>已离世</Text>
            </View>
          )}
        </View>

        <Text className='pet-card__breed'>{pet.breed}</Text>

        <Text className='pet-card__detail'>
          {age} · {pet.weight}kg
        </Text>
      </View>
    </View>
  );
};

export default PetCard;
