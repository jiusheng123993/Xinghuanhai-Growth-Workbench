/**
 * 取名引擎 · 共享工具
 * AI 返回结果解析 + 本地降级名字库 + 命理详情降级
 * 供首页 AI 对话取名流程（useNamingFlow）与独立取名页共用
 */
import type { NamingDetail, NamingResult } from '../types/chatTypes'

/** Fisher-Yates 洗牌，让每次降级结果都有变化 */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** 本地降级名字库（按风格分组，AI 不可用时使用） */
const FALLBACK_NAMES: Record<string, NamingResult[]> = {
  '古风诗意': [
    { name: '墨韵', source: '《墨池记》"临池学书，池水尽墨"', wuxing: '水', starMansion: '壁水貐', meaning: '墨香氤氲，韵味悠长。适合气质优雅、安静从容的宝贝。', score: 95 },
    { name: '云栖', source: '贾岛《寻隐者不遇》"只在此山中，云深不知处"', wuxing: '水', starMansion: '箕水豹', meaning: '云深不知处，栖居于心。安静温柔，与世无争。', score: 92 },
    { name: '霁月', source: '范仲淹《岳阳楼记》"皓月千里"', wuxing: '金', starMansion: '心月狐', meaning: '雨过天晴，月明如洗。寓意拨云见日、好运连连。', score: 88 },
    { name: '青崖', source: '李白"且放白鹿青崖间"', wuxing: '木', starMansion: '角木蛟', meaning: '青崖白鹿，仙气飘飘。寓意自由洒脱、不受拘束。', score: 90 },
    { name: '鹿鸣', source: '《诗经·小雅》"呦呦鹿鸣，食野之苹"', wuxing: '木', starMansion: '亢金龙', meaning: '鹿鸣呦呦，嘉宾满堂。寓意宾主尽欢、生活美满。', score: 93 },
    { name: '兰舟', source: '李清照"轻解罗裳，独上兰舟"', wuxing: '木', starMansion: '氐土貉', meaning: '兰木为舟，悠然自得。适合性格独立、有自己小世界的小宝贝。', score: 87 },
    { name: '竹影', source: '苏轼"竹影横斜水清浅"', wuxing: '木', starMansion: '箕水豹', meaning: '竹影婆娑，清雅脱俗。适合气质清冷、举止优雅的小可爱。', score: 86 },
    { name: '松风', source: '王维"松风吹解带，山月照弹琴"', wuxing: '木', starMansion: '角木蛟', meaning: '松间清风，潇洒自在。适合性格豁达、不拘小节的小家伙。', score: 88 },
    { name: '梅魂', source: '陆游"零落成泥碾作尘，只有香如故"', wuxing: '水', starMansion: '壁水貐', meaning: '傲骨凌霜，幽香如故。适合坚韧不拔的小宝贝。', score: 91 },
    { name: '雪霁', source: '王维"雪霁天晴朗，腊梅处处香"', wuxing: '水', starMansion: '参水猿', meaning: '雪后初晴，天地澄明。寓意苦尽甘来。', score: 89 },
    { name: '星阑', source: '谢灵运"夜星阑以照庭"', wuxing: '火', starMansion: '星日马', meaning: '星光阑珊，静夜相伴。适合夜晚特别活跃的小宝贝。', score: 90 },
    { name: '月弦', source: '杜甫"月弦疑破镜"', wuxing: '水', starMansion: '壁水貐', meaning: '月如弦，思念长。适合温柔深情、特别粘人的宝贝。', score: 85 },
    { name: '云章', source: '《诗经》"倬彼云汉，为章于天"', wuxing: '水', starMansion: '斗木獬', meaning: '云河灿烂，华章天成。适合毛色花纹特别漂亮的小宝贝。', score: 92 },
    { name: '鹤影', source: '杜牧"鹤影松阴，韵致高远"', wuxing: '金', starMansion: '心月狐', meaning: '鹤立鸡群，影姿翩翩。适合气质出众的小可爱。', score: 87 },
    { name: '玉尘', source: '白居易"玉尘散舞，冰花满路"', wuxing: '金', starMansion: '奎木狼', meaning: '玉雪为尘，洁白无瑕。适合白色毛发的纯白小天使。', score: 88 },
    { name: '书瑶', source: '《诗经》"投我以木桃，报之以琼瑶"', wuxing: '土', starMansion: '女土蝠', meaning: '书香与琼瑶，文雅而珍贵。适合安静乖巧的小可爱。', score: 86 },
    { name: '画锦', source: '《诗经》"衣锦尚絅，画其文章"', wuxing: '火', starMansion: '尾火虎', meaning: '如画如锦，绚丽多彩。适合花色斑驳、颜值超高的小宝贝。', score: 90 },
    { name: '琴瑟', source: '《诗经》"琴瑟在御，莫不静好"', wuxing: '木', starMansion: '房日兔', meaning: '琴瑟和鸣，岁月静好。寓意与主人和谐相处、生活美满。', score: 94 },
    { name: '泉音', source: '王维"泉声咽危石，日色冷青松"', wuxing: '水', starMansion: '参水猿', meaning: '泉水叮咚，清脆悦耳。适合叫声好听的宝贝宛如天籁。', score: 86 },
    { name: '露晞', source: '《诗经》"蒹葭萋萋，白露未晞"', wuxing: '水', starMansion: '毕月乌', meaning: '晨露未干，清新纯净。适合早晨特别活泼的小太阳。', score: 85 },
    { name: '风吟', source: '刘禹锡"风吟秋色，月照寒江"', wuxing: '木', starMansion: '箕水豹', meaning: '风吟浅唱，自在随性。喜欢在风中奔跑的自由小精灵。', score: 87 },
    { name: '霜序', source: '《诗经》"九月肃霜，十月涤场"', wuxing: '金', starMansion: '昴日鸡', meaning: '霜降时节，秋意正浓。适合秋天来家里的宝贝。', score: 84 },
  ],
  '可爱萌系': [
    { name: '布丁', source: '源自法式甜点 Pudding，Q弹软糯', wuxing: '木', starMansion: '房日兔', meaning: '甜甜蜜蜜，软软糯糯。让人忍不住想rua。', score: 93 },
    { name: '泡芙', source: '源自法式甜点 Puff，外酥内软', wuxing: '水', starMansion: '虚日鼠', meaning: '外表酥脆内心柔软。适合外表高冷内心温柔的反差萌。', score: 90 },
    { name: '奶糖', source: '源自大白兔奶糖，童年记忆', wuxing: '土', starMansion: '胃土雉', meaning: '奶香四溢，甜而不腻。治愈系首选。', score: 87 },
    { name: '团子', source: '源自日式团子，圆润可爱', wuxing: '火', starMansion: '星日马', meaning: '圆圆滚滚，软糯可爱。适合体型圆润的小家伙。', score: 89 },
    { name: '糯米', source: '源自传统食材，黏糯香甜', wuxing: '土', starMansion: '柳土獐', meaning: '黏黏糯糯，离不开你。特别粘人的跟屁虫小宝贝。', score: 91 },
    { name: '棉花', source: '棉花糖，入口即化的甜蜜', wuxing: '土', starMansion: '女土蝠', meaning: '软软绵绵，轻盈如云。适合毛茸茸的小家伙。', score: 88 },
    { name: '绒绒', source: '形容毛绒绒的柔软触感', wuxing: '金', starMansion: '奎木狼', meaning: '毛绒绒，暖乎乎。适合长毛手感超好的小可爱。', score: 86 },
    { name: '嘟嘟', source: '拟声词，形容肉嘟嘟的样子', wuxing: '土', starMansion: '胃土雉', meaning: '嘟嘟脸，超可爱。适合脸颊肉肉的卖萌小宝贝。', score: 92 },
    { name: '呼呼', source: '拟声词，熟睡的呼吸声', wuxing: '火', starMansion: '心月狐', meaning: '呼呼大睡，岁月静好。特别爱睡觉的小可爱。', score: 85 },
    { name: '泡泡', source: '阳光下五彩缤纷的泡泡', wuxing: '水', starMansion: '虚日鼠', meaning: '五彩泡泡，天真烂漫。活泼好动的小精灵。', score: 87 },
    { name: '糖糖', source: '糖果的叠音，加倍甜蜜', wuxing: '土', starMansion: '柳土獐', meaning: '甜上加甜。适合让人甜到心里的宝贝。', score: 90 },
    { name: '蜜蜜', source: '《诗经》"莫予荏苒，蜜蜜其甘"', wuxing: '水', starMansion: '壁水貐', meaning: '甜蜜如蜜，快乐加倍。性格开朗的小太阳。', score: 89 },
    { name: '萌萌', source: '网络流行语，形容纯真可爱', wuxing: '木', starMansion: '房日兔', meaning: '萌翻全场，天下第一可爱。', score: 94 },
    { name: '胖胖', source: '叠音形容圆润可爱', wuxing: '土', starMansion: '胃土雉', meaning: '胖胖乎乎，可爱到冒泡。抱着手感超棒的小肉球。', score: 83 },
    { name: '乖乖', source: '乖巧懂事，让人省心', wuxing: '土', starMansion: '牛金牛', meaning: '乖乖听话，天下第一乖。性格温顺的小天使。', score: 88 },
    { name: '球球', source: '圆滚滚像个小球', wuxing: '火', starMansion: '星日马', meaning: '圆溜溜的小球，滚来滚去。圆润的小家伙。', score: 86 },
    { name: '卷卷', source: '形容卷曲的毛发或尾巴', wuxing: '木', starMansion: '角木蛟', meaning: '卷卷毛，超好rua。适合卷毛品种的小可爱。', score: 87 },
    { name: '点点', source: '身上的小斑点或小花纹', wuxing: '水', starMansion: '箕水豹', meaning: '点点繁星，落在身上。有斑点的小宝贝。', score: 85 },
    { name: '豆豆', source: '小小一颗，活力满满', wuxing: '木', starMansion: '氐土貉', meaning: '像小豆子一样小巧可爱。体型小能量大的迷你小可爱。', score: 84 },
    { name: '咪咪', source: '拟声词，模仿小猫咪的叫声', wuxing: '火', starMansion: '尾火虎', meaning: '咪咪叫，萌化人心。叫声特别软萌的小猫咪。', score: 88 },
    { name: '乐乐', source: '快乐无忧，天天开心', wuxing: '木', starMansion: '亢金龙', meaning: '快快乐乐，无忧无虑。希望宝贝一生快乐。', score: 91 },
    { name: '圆圆', source: '圆圆满满，幸福团圆', wuxing: '土', starMansion: '女土蝠', meaning: '团团圆圆，幸福美满。宝贝让家更加圆满。', score: 89 },
    { name: '暖暖', source: '暖人心脾的小太阳', wuxing: '火', starMansion: '心月狐', meaning: '暖暖的好贴心。能治愈主人的小可爱。', score: 92 },
  ],
  '食物系列': [
    { name: '年糕', source: '传统年节食品，寓意年年高升', wuxing: '土', starMansion: '女土蝠', meaning: '年年高升，黏人暖心。', score: 94 },
    { name: '汤圆', source: '源自元宵节传统，团团圆圆', wuxing: '水', starMansion: '室火猪', meaning: '团团圆圆，白白胖胖。寓意家庭美满幸福。', score: 91 },
    { name: '麻薯', source: '源自日式点心，Q弹有嚼劲', wuxing: '土', starMansion: '昴日鸡', meaning: 'Q弹软糯，外表朴素内有惊喜。', score: 85 },
    { name: '豆沙', source: '传统馅料，甜而不腻', wuxing: '火', starMansion: '尾火虎', meaning: '细腻绵密，甜在心头。温柔治愈的小可爱。', score: 88 },
    { name: '芝麻', source: '《本草纲目》"八谷之中，惟此为良"', wuxing: '木', starMansion: '氐土貉', meaning: '小小一粒，能量满满。芝麻开花节节高。', score: 86 },
    { name: '花生', source: '长生果，寓意长寿健康', wuxing: '土', starMansion: '牛金牛', meaning: '长生不老，健康快乐。希望宝贝长寿幸福。', score: 90 },
    { name: '核桃', source: '坚果之王，补脑益智', wuxing: '木', starMansion: '角木蛟', meaning: '聪明伶俐，机智过人。学东西特别快的小机灵鬼。', score: 87 },
    { name: '栗子', source: '秋日糖炒栗子，暖手暖心', wuxing: '火', starMansion: '星日马', meaning: '暖呼呼香喷喷。毛色棕红的小家伙。', score: 86 },
    { name: '桂圆', source: '龙眼干，甜润滋补', wuxing: '土', starMansion: '胃土雉', meaning: '圆润甘甜，滋补人心。眼睛又大又圆的小宝贝。', score: 88 },
    { name: '豆花', source: '南方传统甜品，嫩滑清甜', wuxing: '水', starMansion: '箕水豹', meaning: '嫩滑清甜，入口即化。温柔让人心生怜爱。', score: 85 },
    { name: '酸奶', source: '酸甜可口，营养健康', wuxing: '木', starMansion: '房日兔', meaning: '酸酸甜甜，开胃又可爱。让人没办法生气的小调皮。', score: 84 },
    { name: '奶酪', source: '源自西方，浓郁醇厚', wuxing: '土', starMansion: '柳土獐', meaning: '浓郁醇厚，越品越香。越相处越爱不释手。', score: 87 },
    { name: '奶茶', source: '现代人气饮品，甜蜜暖心', wuxing: '水', starMansion: '虚日鼠', meaning: '甜暖人心，每天都需要你。每天都要吸一口的小可爱。', score: 89 },
    { name: '芋圆', source: '台湾传统甜品，Q弹香甜', wuxing: '土', starMansion: '女土蝠', meaning: 'QQ弹弹，软糯清甜。让人心情变好的小甜心。', score: 88 },
    { name: '冰粉', source: '夏日清凉甜品，晶莹剔透', wuxing: '水', starMansion: '参水猿', meaning: '晶莹剔透，清爽宜人。夏天出生的小宝贝。', score: 83 },
    { name: '凉糕', source: '传统夏日糕点，清甜软糯', wuxing: '土', starMansion: '昴日鸡', meaning: '清清凉凉，软糯可口。性格温和的乖宝贝。', score: 84 },
    { name: '糍粑', source: '传统糯米制品，软糯香甜', wuxing: '土', starMansion: '胃土雉', meaning: '糯糯叽叽，甜甜蜜蜜。粘人又可爱的软萌小宝贝。', score: 86 },
    { name: '烧麦', source: '传统点心，皮薄馅多', wuxing: '火', starMansion: '尾火虎', meaning: '皮薄馅多，内涵丰富。外表普通但内心丰富的小可爱。', score: 82 },
    { name: '酥饼', source: '传统酥皮点心，层层酥脆', wuxing: '金', starMansion: '奎木狼', meaning: '层层酥脆，满口留香。性格爽快的小宝贝。', score: 85 },
    { name: '蛋挞', source: '源自澳式葡挞，酥脆香甜', wuxing: '火', starMansion: '心月狐', meaning: '酥脆外皮，嫩滑内心。外表高冷内心柔软的傲娇小可爱。', score: 87 },
    { name: '糖葫芦', source: '传统街头小吃，酸甜诱人', wuxing: '火', starMansion: '星日马', meaning: '酸酸甜甜，五彩缤纷。永远充满惊喜的小家伙。', score: 86 },
    { name: '杏仁', source: '健康坚果，香脆可口', wuxing: '木', starMansion: '亢金龙', meaning: '香香脆脆，营养满满。整天忙忙碌碌的小可爱。', score: 84 },
    { name: '豆浆', source: '传统早餐饮品，醇厚温暖', wuxing: '水', starMansion: '壁水貐', meaning: '醇厚温暖，晨间必备。每天叫你起床的小宝贝。', score: 85 },
    { name: '馄饨', source: '传统面食，皮薄馅鲜', wuxing: '水', starMansion: '毕月乌', meaning: '小小一个，鲜美暖心。喜欢蜷缩成一团睡觉的小可爱。', score: 83 },
  ],
  '自然元素': [
    { name: '星河', source: '曹操"星汉灿烂，若出其里"', wuxing: '水', starMansion: '斗木獬', meaning: '璀璨星河，独一无二。愿成为你生命中最亮的光。', score: 96 },
    { name: '山月', source: '王维"明月松间照，清泉石上流"', wuxing: '土', starMansion: '牛金牛', meaning: '山间明月，清辉婉转。安静而坚定的陪伴。', score: 90 },
    { name: '朝露', source: '曹操"譬如朝露，去日苦多"', wuxing: '水', starMansion: '参水猿', meaning: '清晨露珠，纯净珍贵。每一天都是新的开始。', score: 87 },
    { name: '霜华', source: '张继"月落乌啼霜满天"', wuxing: '金', starMansion: '奎木狼', meaning: '霜华满地，银装素裹。白色毛发的宝贝自带仙气。', score: 89 },
    { name: '烟雨', source: '杜牧"多少楼台烟雨中"', wuxing: '水', starMansion: '毕月乌', meaning: '烟雨朦胧，诗意盎然。毛色特别的小可爱。', score: 92 },
    { name: '云岫', source: '陶渊明"云无心以出岫"', wuxing: '水', starMansion: '箕水豹', meaning: '云出山岫，自由悠然。性格随性的小家伙。', score: 88 },
    { name: '溪云', source: '王维"行到水穷处，坐看云起时"', wuxing: '水', starMansion: '壁水貐', meaning: '溪边看云，恬淡豁达。心态超好的小宝贝。', score: 90 },
    { name: '林泉', source: '白居易"林泉之乐，得之心而寓之趣"', wuxing: '木', starMansion: '角木蛟', meaning: '山林泉石，返璞归真。户外小探险家。', score: 87 },
    { name: '竹月', source: '王维"深林人不知，明月来相照"', wuxing: '木', starMansion: '房日兔', meaning: '竹林月影，清幽宁静。文静优雅的小可爱。', score: 86 },
    { name: '晴岚', source: '范成大"晴岚染翠，山色空蒙"', wuxing: '火', starMansion: '星日马', meaning: '晴天山岚，明朗清新。给人带来阳光的小家伙。', score: 89 },
    { name: '晚照', source: '李白"晚照千峰，暮色苍茫"', wuxing: '金', starMansion: '心月狐', meaning: '夕阳晚照，温柔绚烂。黄昏时分最活跃的小宝贝。', score: 85 },
    { name: '初雪', source: '韩愈"白雪却嫌春色晚"', wuxing: '水', starMansion: '虚日鼠', meaning: '初雪纷飞，纯洁美好。冬天来家里的宝贝。', score: 91 },
    { name: '春涧', source: '王维"月出惊山鸟，时鸣春涧中"', wuxing: '水', starMansion: '箕水豹', meaning: '春水潺潺，生机盎然。让家里热闹起来的小精怪。', score: 88 },
    { name: '秋水', source: '王勃"秋水共长天一色"', wuxing: '水', starMansion: '斗木獬', meaning: '秋水长天，一望无际。眼神清澈有灵气。', score: 90 },
    { name: '海蓝', source: '大海的颜色，深邃广阔', wuxing: '水', starMansion: '室火猪', meaning: '海蓝深邃，包容一切。沉稳的守护型宝贝。', score: 86 },
    { name: '风信', source: '风信子，春天的信使', wuxing: '木', starMansion: '亢金龙', meaning: '风信传来，春暖花开。给家庭带来快乐的小使者。', score: 87 },
    { name: '花信', source: '二十四番花信风，时令之美', wuxing: '木', starMansion: '氐土貉', meaning: '花信如期，美好如约。让人期待回家的小宝贝。', score: 88 },
    { name: '草芽', source: '春天初生的草芽，充满希望', wuxing: '木', starMansion: '角木蛟', meaning: '春草初芽，生机勃勃。正在成长中的幼崽。', score: 84 },
    { name: '虹霓', source: '雨后彩虹，绚丽夺目', wuxing: '火', starMansion: '尾火虎', meaning: '彩虹横空，绚烂多彩。花色艳丽的小可爱。', score: 89 },
    { name: '雾凇', source: '冬日雾凇，晶莹剔透', wuxing: '金', starMansion: '昴日鸡', meaning: '雾凇挂枝，冰清玉洁。白色浅色的小宝贝有仙气。', score: 86 },
    { name: '霞光', source: '朝霞晚霞灿烂夺目', wuxing: '火', starMansion: '星日马', meaning: '霞光万道，光芒万丈。像小太阳一样的活宝。', score: 90 },
    { name: '雪绒', source: '雪花般轻柔的绒毛', wuxing: '水', starMansion: '毕月乌', meaning: '雪绒花，温柔洁白。抱起来像云朵一样。', score: 87 },
    { name: '泉音', source: '泉水叮咚清脆悦耳', wuxing: '水', starMansion: '参水猿', meaning: '清泉石上，声声悦耳。叫声特别好听的小宝贝。', score: 85 },
    { name: '叶脉', source: '叶片的脉络生命的纹理', wuxing: '木', starMansion: '氐土貉', meaning: '叶脉交错，生命之网。花纹独特的小可爱。', score: 83 },
  ],
}

/** 按风格生成降级名字（最多 5 个，去重已推荐） */
export function generateFallbackNames(style: string, excludeNames?: string[]): NamingResult[] {
  const matched = Object.entries(FALLBACK_NAMES).find(([key]) => style.includes(key))
  if (matched) {
    const filtered = matched[1].filter(n => !excludeNames?.includes(n.name))
    return shuffle(filtered).slice(0, 5)
  }

  // 不限风格 → 从所有风格中混合抽取（大幅增加多样性）
  const allPool = Object.values(FALLBACK_NAMES).flat()
  const filtered = allPool.filter(n => !excludeNames?.includes(n.name))
  return shuffle(filtered).slice(0, 5)
}

/**
 * 名字位置上的停用词（2026-09-10 审查 P2）
 *
 * 行解析会把散文切成"名字"：服务端 `/api/ai/chat` 命中越界词表时返回的固定话术
 * （"…咱们还是聊你家毛孩子吧：给它打个卡…"）就曾被切成 `你家毛孩子吧` 渲染成候选卡。
 * 这些词出现在 name 位置即说明解析错了。
 */
const NAME_STOPWORDS = /推荐|名字|名称|以下|如下|建议|候选|寓意|专注|毛孩子|宝贝|宠物|你好|欢迎/

/**
 * 归一化 AI 返回的单个名字项
 *
 * 2026-09-10 加固：此前 json 分支直接 `JSON.parse(...) as NamingResult[]` 不做字段校验，
 * AI 返回空 name／把说明文字当 name（截断的 JSON 尤其容易）时会渲染出空白卡片。
 * 这里统一清洗名字（去引号/括号/空白）并丢弃无效项。
 * @returns 合法名字项；name 缺失或明显不是名字（>6 字）时返回 null
 */
function normalizeNameItem(raw: Partial<NamingResult> | null | undefined): NamingResult | null {
  const name = String(raw?.name ?? '')
    // 剥离编号前缀（"1. 布丁" / "2、团子" / "3) 汤圆"）：编号不是名字的一部分
    .replace(/^[\d０-９]+\s*[.、)）:：]\s*/, '')
    .replace(/[「」【】《》"“”'‘’\s]/g, '')
    // 剥离名字两侧的分隔符残渣（"云栖 - 云深不知处" 这类行会把 " -" 带进名字）
    .replace(/^[-–—~～·]+|[-–—~～·]+$/g, '')
    .trim()
  // 名字应为 2-6 字：空/单字基本是解析残渣（语气词、标点剥离后的碎片）；
  // 过长说明解析到了正文/说明文字
  if (!name || name.length < 2 || name.length > 6) return null
  // 含标点的候选基本是引导语/正文碎片（"推荐如下"、"名字如下"这类靠长度拦不住）
  if (/[，,。！!？?；;：:、（）()【】《》]/.test(name)) return null
  // 停用词与语气词结尾：服务端越界拒绝话术（"…咱们还是聊你家毛孩子吧：给它打个卡…"）
  // 与各类引导语被行解析切出来时都会命中（2026-09-10 审查 P2）
  if (NAME_STOPWORDS.test(name) || /[吧呢哦啊啦嘛呀]$/.test(name)) return null

  const scoreNum = Number(raw?.score)
  return {
    name,
    source: String(raw?.source ?? '').trim(),
    wuxing: String(raw?.wuxing ?? '').trim(),
    starMansion: String(raw?.starMansion ?? '').trim(),
    meaning: String(raw?.meaning ?? '').trim(),
    // 评分缺失/非法时给中性分，避免卡片星级渲染成 NaN 个星
    score: Number.isFinite(scoreNum) ? Math.min(100, Math.max(1, Math.round(scoreNum))) : 85,
  }
}

/** 解析 AI 返回的推荐 JSON（兼容数组与文本兜底） */
export function parseRecommendResult(text: string): NamingResult[] {
  // 越界拒绝话术 / 空内容：直接判定"没有名字"，让调用方走本地名字库兜底
  // （2026-09-10 审查 P2：此前行解析会把话术句尾切成假名字并渲染成候选卡）
  if (!text || text.includes('只专注养宠')) return []

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<NamingResult>[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cleaned = parsed
          .map(normalizeNameItem)
          .filter((n): n is NamingResult => n !== null)
        if (cleaned.length > 0) {
          return cleaned.slice(0, 5)
        }
      }
    }
  } catch {
    // JSON 解析失败，尝试文本解析
  }

  const results: NamingResult[] = []
  // JSON 残片行（截断输出常见）不是名字行，先剔除，避免把 '{"name"' 当成名字
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('{') && !l.startsWith('[') && !l.startsWith('"name"'))
  for (const line of lines) {
    const nameMatch = line.match(/[「【《]?\s*(.{1,8})\s*[」】》]?[:：\s]+(.+)/)
    if (nameMatch) {
      // 编号列表（"1. 布丁 甜甜软软"）：编号是**排名**，映射为高分而非低分
      // （2026-09-10 审查 P2：此前 rank1 → 10 分 → 卡片只显示 1 星，左侧却挂"推荐"徽章）
      const numbered = line.match(/^\s*(\d+)\s*[.、)）]\s*/)
      const rank = numbered ? parseInt(numbered[1], 10) : 0
      const item = normalizeNameItem({
        name: nameMatch[1],
        meaning: nameMatch[2],
        score: rank > 0 ? Math.max(60, 100 - (rank - 1) * 5) : undefined,
      })
      if (item) results.push(item)
    }
  }

  if (results.length === 0) {
    const numRegex = /(\d+)[.、]\s*[「【《]?\s*(.{1,8})\s*[」】》]?\s*[:：\s-]+(.+)/g
    let match: RegExpExecArray | null
    while ((match = numRegex.exec(text)) !== null) {
      // 同编号列表口径：编号是排名 → 高分（rank1=100，每名递减 5，最低 60）
      const rank = parseInt(match[1], 10)
      const item = normalizeNameItem({
        name: match[2],
        meaning: match[3],
        score: Math.max(60, 100 - (rank - 1) * 5),
      })
      if (item) results.push(item)
    }
  }

  return results.slice(0, 5)
}

/** 解析 AI 返回的命理详情 JSON */
export function parseDetailResult(text: string): NamingDetail | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as NamingDetail
    }
  } catch {
    // fall through
  }
  return null
}

/** 生成命理分析降级数据 */
export function generateFallbackDetail(name: string, wuxing: string, starMansion: string): NamingDetail {
  return {
    name,
    bazi: `「${name}」二字与出生时令相应，八字中${wuxing}气充盈，天地人三才和谐。此名暗合五行生克之道，${wuxing}主运，得${starMansion}守护，命格中正平和。`,
    fortune: `从整体运势来看，「${name}」这个名字自带祥瑞之气。${wuxing}行当令，${starMansion}护佑，运势如春日之苗，虽不见其增，日有所长。一生平安顺遂，福泽绵长。`,
    careerFortune: `得${starMansion}星辉照耀，在生活与玩乐中表现出色。${wuxing}行旺盛，精力充沛，活力四射。日常中总能成为焦点，带给家人无限欢乐。`,
    loveFortune: `${starMansion}主掌情缘，与主人缘分深厚。${wuxing}行相生，彼此之间气场相合，相处融洽。此名有助于增进与家人、其他宠物之间的感情纽带。`,
    healthFortune: `五行${wuxing}平衡，${starMansion}守护，身体根基稳固。注意根据季节变化适当调理，${wuxing}旺之时注意互补，整体健康运势良好。`,
    personality: `「${name}」这个名字赋予的气质是温润中带着灵动。${wuxing}行特质明显，${starMansion}加持，性格中既有沉稳的一面，又有活泼的天性，内外兼修。`,
    strokes: `经传统姓名学笔画推算，「${name}」二字笔画数合于吉数，数理通达。笔画结构匀称，书写流畅，寓意吉祥如意，福寿安康。`,
    luckyDirection: wuxing === '木' ? '东方' : wuxing === '火' ? '南方' : wuxing === '金' ? '西方' : wuxing === '水' ? '北方' : '中央',
    luckyColor: wuxing === '木' ? '青色、绿色' : wuxing === '火' ? '红色、紫色' : wuxing === '金' ? '白色、金色' : wuxing === '水' ? '黑色、蓝色' : '黄色、棕色',
    luckyNumber: wuxing === '木' ? '3、8' : wuxing === '火' ? '2、7' : wuxing === '金' ? '4、9' : wuxing === '水' ? '1、6' : '5、0',
    karmaWithOwner: `「${name}」这个名字与主人的气场天然契合。${starMansion}星辉与主人命格相呼应，彼此的缘分如同${wuxing}行相生，绵延不绝。此名将成为连接主人与宠物之间的情感纽带。`,
    summary: `「${name}」是一个充满文化底蕴和吉祥寓意的名字。${starMansion}守护，${wuxing}行调和，运势亨通。愿这个名字陪伴宝贝度过平安喜乐的每一天，也愿主人与宝贝之间的缘分如同星河流转，生生不息。`,
  }
}
