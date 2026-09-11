/**
 * 异常标记组件
 * 在健康趋势图上标记异常点，展示风险等级和详情气泡
 */
import { useState } from 'react';
import { View, Text } from '@tarojs/components';
import './AnomalyMarker.scss';

type RiskLevel = 'normal' | 'caution' | 'warning' | 'emergency';

interface AnomalyMarkerProps {
  date: string;
  riskLevel: RiskLevel;
  description?: string;
  items: string[];
  position: { x: number; y: number };
  onClick?: (date: string) => void;
}

const RISK_COLOR_MAP: Record<RiskLevel, string> = {
  normal: '#52C41A',
  caution: '#FAAD14',
  warning: '#FF8C42',
  emergency: '#FF4D4F',
};

const RISK_LABEL_MAP: Record<RiskLevel, string> = {
  normal: '正常',
  caution: '注意',
  warning: '警告',
  emergency: '紧急',
};

export default function AnomalyMarker({
  date,
  riskLevel,
  description,
  items,
  position,
  onClick,
}: AnomalyMarkerProps) {
  const [expanded, setExpanded] = useState(false);
  const color = RISK_COLOR_MAP[riskLevel];
  const label = RISK_LABEL_MAP[riskLevel];

  const handleMarkerClick = () => {
    setExpanded((prev) => !prev);
    onClick?.(date);
  };

  const handleOverlayClick = () => {
    setExpanded(false);
  };

  return (
    <>
      {expanded && (
        <View className='anomaly-marker__overlay' onClick={handleOverlayClick} />
      )}
      <View
        className={`anomaly-marker anomaly-marker--${riskLevel}`}
        style={{ left: `${position.x}%`, top: `${position.y}%` }}
      >
        <View className='anomaly-marker__dot-wrapper' onClick={handleMarkerClick}>
          <View
            className='anomaly-marker__dot'
            style={{ backgroundColor: color }}
          />
          {riskLevel === 'emergency' && (
            <View
              className='anomaly-marker__pulse'
              style={{ borderColor: color }}
            />
          )}
        </View>

        {expanded && (
          <View className='anomaly-marker__bubble'>
            <View className='anomaly-marker__arrow' />
            <View className='anomaly-marker__bubble-content'>
              <View className='anomaly-marker__header'>
                <Text className='anomaly-marker__date'>{date}</Text>
                <View
                  className={`anomaly-marker__badge anomaly-marker__badge--${riskLevel}`}
                  style={{ backgroundColor: `${color}1A`, borderColor: `${color}40` }}
                >
                  <Text
                    className='anomaly-marker__badge-text'
                    style={{ color }}
                  >
                    {label}
                  </Text>
                </View>
              </View>

              {description && (
                <Text className='anomaly-marker__description'>{description}</Text>
              )}

              {items.length > 0 && (
                <View className='anomaly-marker__items'>
                  {items.map((item) => (
                    <View
                      className='anomaly-marker__item'
                      key={item}
                      style={{ backgroundColor: `${color}0D` }}
                    >
                      <View
                        className='anomaly-marker__item-dot'
                        style={{ backgroundColor: color }}
                      />
                      <Text className='anomaly-marker__item-text'>{item}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    </>
  );
}
