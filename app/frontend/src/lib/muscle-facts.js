// yuan-Gym — the facts behind every muscle the body map draws.
//
// One table, shared by the 3D model and the page above it, so a muscle's name, what it
// does and how you train it can never drift apart.
//
// `facing` says which side of the body the group belongs to — 'front' for the ones a front
// view shows, 'back' for the ones it hides. The viewer uses it to label the two views and
// to fade the far side when the figure is turned around.
//
// The model itself keeps the app's own dark palette: every muscle wears the same muted
// red, and only the one you pick lights up. Colour is therefore not a channel here —
// position, shape and the highlight do the identifying.

export const MUSCLE_FACTS = {
  // ---- front ----
  chest: {
    cn: '胸大肌', en: 'Pectorals', facing: 'front',
    fn: '内收、屈曲上臂，把上臂拉向身体中线。推的动作都靠它发力。',
    train: '卧推、俯卧撑、飞鸟。',
  },
  deltoids: {
    cn: '三角肌', en: 'Deltoids', facing: 'front',
    fn: '把上臂向前、向外、向上抬起，是肩关节的主要稳定肌。',
    train: '推举、侧平举、绕环。',
  },
  biceps: {
    cn: '肱二头肌', en: 'Biceps', facing: 'front',
    fn: '屈肘与屈肩，也是前臂旋后的主力。',
    train: '弯举、划船、引体向上。',
  },
  forearm: {
    cn: '肱肌 / 前臂', en: 'Brachialis & forearms', facing: 'front',
    fn: '屈肘深层肌与握持、腕关节控制，决定你能抓住多少重量。',
    train: '弯举、腕弯举、握力训练。',
  },
  abs: {
    cn: '腹直肌群', en: 'Abdominals', facing: 'front',
    fn: '屈曲躯干、抗伸展，把力量从下肢传到上肢。',
    train: '卷腹、悬垂举腿、负重体屈伸。',
  },
  obliques: {
    cn: '腹斜肌', en: 'Obliques', facing: 'front',
    fn: '躯干旋转与侧屈，抗旋转地稳定骨盆。',
    train: '侧平板、俄罗斯转体、负重侧屈。',
  },
  serratus: {
    cn: '前锯肌', en: 'Serratus anterior', facing: 'front',
    fn: '肩胛骨前伸与上回旋，把肩胛贴在肋骨上，推举末端的关键。',
    train: '过头推举、俯卧撑加前伸、肩胛俯卧撑。',
  },
  quadriceps: {
    cn: '股四头肌', en: 'Quadriceps', facing: 'front',
    fn: '伸膝，蹲、上台阶、跑跳都靠它。',
    train: '深蹲、腿举、腿弯举。',
  },
  tibialis: {
    cn: '胫骨前肌', en: 'Tibialis anterior', facing: 'front',
    fn: '踝背屈，拉住小腿防止胫骨过度前移，跑步人群的关键。',
    train: '弹跑、提踵、靠墙静蹲。',
  },
  adductors: {
    cn: '内收肌群', en: 'Adductors', facing: 'front',
    fn: '大腿内收，深蹲底部的稳定器，防止膝盖外翻。',
    train: '深蹲、夹腿、侧向跨步。',
  },
  'hip-flexors': {
    cn: '髂腰肌', en: 'Hip flexors', facing: 'front',
    fn: '屈髋抬高腿，久坐容易紧张，会牵扯腰椎。',
    train: '悬垂举腿、弓步、拉伸放松。',
  },

  // ---- back ----
  trapezius: {
    cn: '斜方肌', en: 'Trapezius', facing: 'back',
    fn: '肩胛骨上提、后缩与旋转，稳定整个肩带。',
    train: '耸肩、俯身划船、YTW。',
  },
  'upper-back': {
    cn: '背阔肌', en: 'Latissimus dorsi', facing: 'back',
    fn: '肩胛后缩下压、伸肩内收，是"拉"的主力。',
    train: '引体向上、下拉、划船。',
  },
  'lower-back': {
    cn: '竖脊肌', en: 'Erector spinae', facing: 'back',
    fn: '维持脊柱中立，髋铰链时做等长收缩。',
    train: '硬拉、俯身挺身、山羊挺身。',
  },
  triceps: {
    cn: '肱三头肌', en: 'Triceps', facing: 'back',
    fn: '伸肘，推类动作的"锁定"阶段靠它。',
    train: '臂屈伸、窄距卧推、俯卧撑。',
  },
  gluteal: {
    cn: '臀大肌', en: 'Glutes', facing: 'back',
    fn: '髋伸展与外旋，是人体最强的发力肌。',
    train: '臀推、深蹲、硬拉。',
  },
  hamstring: {
    cn: '腘绳肌', en: 'Hamstrings', facing: 'back',
    fn: '屈膝与髋伸展，冲刺与硬拉的核心。',
    train: '腿弯举、硬拉、罗马尼亚硬拉。',
  },
  calves: {
    cn: '腓肠肌', en: 'Calf', facing: 'back',
    fn: '踝跖屈，跑跳的"弹簧"，也负责久站时的缓冲。',
    train: '提踵、跳绳、跑步。',
  },

  // 210 块精细图谱里另外三类：能单独点选，但没有对应的训练动作部位。
  // 它们不在 lib/muscles.js 的 MUSCLES 里，所以热力图 / 疲劳 / 训练量不会把它们算进去；
  // 这里只提供显示名与朝向，让模型知道正面视图该不该画它们。
  face: {
    cn: '面部肌群', en: 'Facial muscles', facing: 'front',
    fn: '表情与咀嚼肌，不计入训练负荷。', train: '',
  },
  foot: {
    cn: '足底肌群', en: 'Foot muscles', facing: 'front',
    fn: '维持足弓与脚趾稳定，不计入训练负荷。', train: '',
  },
  neck: {
    cn: '颈部肌群', en: 'Neck muscles', facing: 'front',
    fn: '稳定头颈、辅助呼吸，不计入训练负荷。', train: '',
  },
}

// The two groups the 3D figure splits into halves — the view buttons and the view labels
// both read from this.
export const FRONT_GROUPS = Object.keys(MUSCLE_FACTS).filter(k => MUSCLE_FACTS[k].facing === 'front')
export const BACK_GROUPS = Object.keys(MUSCLE_FACTS).filter(k => MUSCLE_FACTS[k].facing === 'back')

/** The muscle's display name in Chinese, falling back to the app's own English label. */
export const cnName = (slug, fallback = '') => MUSCLE_FACTS[slug]?.cn || fallback || slug

/** 精确的学术名称：界面为中文时返回中文名，其它语言返回英文名。
 *  `fallback` 是调用方已翻译过的旧标签，用它兜底判断「实际显示语言」：一份从没在设置里
 *  手动选过语言的拷贝（langAuto）里 S.lang 仍是 'en'，但 t() 已按系统语言显示中文，
 *  这时必须给中文学术名，不能给 Pectorals。 */
export const academicName = (slug, lang = 'zh', fallback = '') => {
  const f = MUSCLE_FACTS[slug]
  if (!f) return fallback || slug
  const chinese = String(lang || '').toLowerCase().startsWith('zh')
    || /[\u3400-\u9fff]/.test(String(fallback || ''))
  return chinese ? f.cn : f.en
}

/** What this muscle does and how you train it — the two lines the chart prints. */
export const muscleFacts = slug => MUSCLE_FACTS[slug] || { cn: slug, en: '', facing: 'front', fn: '', train: '' }
