// yuan-Gym — exercise coaching layer.
//
// The catalogue knows what an exercise is called, what it needs and which muscles it
// trains. It says nothing about how to perform it. This module supplies that, in four
// registers, for all ~5,600 movements:
//
//   howto   — the execution, as a short ordered sequence
//   cues    — technique keys that change the result
//   feel    — how to actually find the target muscle (the thing beginners cannot do)
//   caution — what goes wrong, and who should be careful
//
// Resolution order: a hand-written entry for a flagship movement, then movement-pattern
// rules matched against the exercise name, then a muscle-level fallback. Every exercise
// therefore gets an answer, and the well-known ones get a good one.
//
// `rating` is a 1-5 recommendation for a general trainee (stimulus per unit of risk and
// setup cost), not a difficulty score.

const pad = s => String(s || '')

// ---------------------------------------------------------------------------
// Muscle-level fallback: what this muscle does and how it feels when it works.
// ---------------------------------------------------------------------------

export const MUSCLE_GUIDE = {
  chest: {
    action: '把上臂拉向身体中线（水平内收）',
    feel: '想象用两侧肘窝夹住一支笔，顶峰时胸口中间发紧，而不是肩膀前侧酸痛。',
    cue: '肩胛骨向下收，别耸肩；下放时用 3 秒，让胸肌被拉长。',
  },
  'upper-back': {
    action: '把肩胛骨向后下方收紧（后缩 + 下压）',
    feel: '先把肩胛骨"夹一下"，再用手肘把重量拉过来，背心位置发紧才算对。',
    cue: '手只是钩子，手臂尽量放松，想着"用肘尖往后戳"。',
  },
  'lower-back': {
    action: '维持脊柱中立、伸展髋部',
    feel: '腰不是主动发力点，应该是臀部和大腿后侧在推，腰只负责稳定。',
    cue: '全程收下巴、绷紧腹部，像被一根绳子从头顶拉着。',
  },
  deltoids: {
    action: '把上臂向外抬起 / 向上推',
    feel: '三角肌中束发力时，肩膀外侧会鼓起来；如果斜方肌先酸，说明重量大了或耸肩。',
    cue: '手肘领先于手腕，抬到与肩平即可，不要用甩的。',
  },
  trapezius: {
    action: '肩胛骨上提与后缩',
    feel: '脖子两侧到肩膀的斜方肌上束收紧，动作幅度小而集中。',
    cue: '不要转头、不要用腰发力，顶点停 1 秒。',
  },
  biceps: {
    action: '屈肘',
    feel: '大臂保持不动，只有前臂在转；如果肩膀跟着抬，说明重量超出二头肌能力。',
    cue: '手腕保持中立，下放时不要让重量"掉"下去。',
  },
  triceps: {
    action: '伸肘',
    feel: '手肘后侧的三头肌收紧，大臂像被钉在体侧一样不动。',
    cue: '肘尖朝前或朝上并固定，别让它前后晃。',
  },
  forearm: {
    action: '屈伸腕与握持',
    feel: '前臂靠近手肘的那段发胀，握力比腕关节更先疲劳。',
    cue: '手腕不塌，重量宁轻不重。',
  },
  abs: {
    action: '脊柱屈曲 + 抗伸展（把肋骨拉向骨盆）',
    feel: '不是脖子发力，是腹部中间像被收紧的皮带，呼气时最明显。',
    cue: '先呼气把肋骨收下去，动作幅度小一点，慢一点。',
  },
  obliques: {
    action: '躯干侧屈与旋转',
    feel: '腰侧、肋骨下缘的肌肉收紧；如果腰疼，多是靠腰甩而不是旋转。',
    cue: '骨盆保持稳定，旋转来自胸椎。',
  },
  serratus: {
    action: '肩胛骨前伸与上回旋',
    feel: '腋下肋骨侧面的小肌群发紧，推举顶点时手再"往前送一点"就能找到。',
    cue: '幅度很小，重点是顶端那一下前伸。',
  },
  gluteal: {
    action: '髋伸展与外旋',
    feel: '臀部中间的酸胀感，而不是大腿前侧或腰部；顶点主动夹臀 1 秒。',
    cue: '腹肌收紧防止塌腰代偿，膝盖别内扣。',
  },
  quadriceps: {
    action: '伸膝',
    feel: '大腿前侧靠近膝盖的位置先累，膝盖始终跟着脚尖方向。',
    cue: '重心在脚中后部，下蹲时脚跟不离地。',
  },
  hamstring: {
    action: '屈膝 + 髋伸展',
    feel: '大腿后侧被拉长后收紧；如果只是腰酸，说明髋没铰链、动作变成了弯腰。',
    cue: '想着"屁股往后顶"，而不是"身体往下压"。',
  },
  adductors: {
    action: '大腿内收',
    feel: '大腿内侧发紧，动作幅度不必大，重点是内侧的持续张力。',
    cue: '缓慢控制回程，别让重量把腿"弹"开。',
  },
  'hip-flexors': {
    action: '屈髋（抬腿）',
    feel: '大腿根前侧发力；若腰部酸痛，说明腹部没收紧，骨盆前倾代偿。',
    cue: '收紧腹部、微微后倾骨盆再做。',
  },
  calves: {
    action: '踝跖屈（踮脚）',
    feel: '小腿后侧靠上的两块肌肉鼓起，落地时慢慢下放到最低点拉长。',
    cue: '膝盖微屈并固定，顶点停 1 秒。',
  },
  tibialis: {
    action: '踝背屈（勾脚）',
    feel: '小腿前侧、胫骨旁边发紧，常见于跑步人群的胫骨前肌。',
    cue: '慢速控制，范围小，可作为热身激活。',
  },
}

// ---------------------------------------------------------------------------
// Hand-written entries for the movements most people should be doing.
// Key = lowercase fragment that must appear in the exercise name.
// ---------------------------------------------------------------------------

const CURATED = [
  {
    match: 'barbell bench press',
    rating: 5,
    level: '中级',
    scheme: '4 组 × 5–8 次，组间 2–3 分钟',
    howto: [
      '躺下让眼睛在杠铃正下方，肩胛骨向后向下收紧并"锁死"在凳面上。',
      '双手略宽于肩握杠，脚掌踩实地面，臀部不离凳。',
      '吸气、出杠，杠铃落到胸骨中下部（乳线），肘部约 45–70° 夹角。',
      '呼气发力推起，杠铃走一条略向头侧倾斜的弧线，回到肩上方。',
    ],
    cues: [
      '全程肩胛后缩下沉——这是卧推最重要的一件事，比重量重要。',
      '双脚蹬地产生"腿部驱动"，把力量从脚传到杠。',
      '手腕保持中立叠在肘上方，别让杠压到手掌根部。',
    ],
    feel: '推到一半最难的位置（粘滞点）时，主动用两侧肘往中间"夹"，胸肌会明显收紧。',
    caution: '肩前侧疼痛时先减小下放幅度、改用哑铃；不要做"弹胸"式反弹。',
  },
  {
    match: 'barbell back squat',
    rating: 5,
    level: '中级',
    scheme: '4 组 × 5 次，组间 3 分钟',
    howto: [
      '杠铃放在斜方肌上部（高杠）或三角肌后束上（低杠），双手握紧。',
      '站距与肩同宽或略宽，脚尖外展 15–30°。',
      '吸气收紧腹部，屈髋屈膝同时下沉，膝盖顺脚尖方向推开。',
      '下到髋低于膝（或自身可控深度），脚掌三点压地起身。',
    ],
    cues: [
      '先屈髋再屈膝，像"坐进两腿之间"而不是"往前跪"。',
      '全程保持腹部压力，胸腔不塌。',
      '起身时想着"把地面推开"，髋和肩同时上升。',
    ],
    feel: '屁股和腿后侧先有拉伸感，起身中段大腿前侧发力最重。如果只有膝盖不舒服、臀部没感觉，多半是重心太靠前。',
    caution: '腰部不适者先做高脚杯深蹲或腿举；务必使用保护杠。',
  },
  {
    match: 'conventional deadlift',
    rating: 5,
    level: '进阶',
    scheme: '3–5 组 × 3–5 次，组间 3 分钟以上',
    howto: [
      '站距与髋同宽，杠在脚掌中线正上方，小腿距杠约 2–3 cm。',
      '屈髋俯身握杠，肩略在杠前方，背部绷平，腋下"夹紧"。',
      '吸气、绷紧全身，先用腿"推地"把杠带离地面。',
      '杠过膝后髋部前送，站直时臀部收紧，不要后仰。',
    ],
    cues: [
      '把杠拉向身体，贴腿走，越近越省力。',
      '手臂只是绳子的两端，不要用手臂"拉"。',
      '每次重复都重新建立腹部压力，不连续弹跳。',
    ],
    feel: '起杠瞬间腿后侧和臀部绷紧，背部只是等长收缩稳定。如果腰先累，说明髋铰链没做出来。',
    caution: '椎间盘问题、血压高者慎做；宁可用六角杠或罗马尼亚硬拉替代。',
  },
  {
    match: 'romanian deadlift',
    rating: 5,
    level: '中级',
    scheme: '3 组 × 8–10 次，组间 2 分钟',
    howto: [
      '站直握杠，膝盖微屈并固定角度。',
      '髋部向后推，杠贴大腿下滑，脊柱保持中立。',
      '感到腿后侧拉长到极限（约小腿中段）时停住。',
      '臀部发力把髋推回去，站直但不过度后仰。',
    ],
    cues: ['这是"髋铰链"动作，膝盖几乎不动。', '下巴微收，颈部跟脊柱一条线。', '下放速度慢，回程可以稍快。'],
    feel: '大腿后侧像被拉紧的橡皮筋，站直那一刻臀部收紧。腰酸=动作变成了弯腰。',
    caution: '握力不足可用助力带；下背疲劳时不要安排在大重量硬拉次日。',
  },
  {
    match: 'pull-up',
    rating: 5,
    level: '中级',
    scheme: '4 组 × 力竭前 1–2 次，组间 2 分钟',
    howto: [
      '正握略宽于肩悬挂，肩胛先下沉（不要耸肩挂在关节上）。',
      '想着"用手肘往腰侧拉"，把胸口带向杠。',
      '上到下巴过杠或胸口接近杠，稍停。',
      '用 2–3 秒控制下放到手臂伸直。',
    ],
    cues: ['先启动背，再启动手臂。', '身体微微后倾，别前后摆荡借力。', '做不动就用弹力带或辅助器械，别用甩的。'],
    feel: '背阔肌从腋下到腰侧一整片收紧。若只有二头酸，说明肩胛没先下沉。',
    caution: '肩关节不稳者先做肩胛悬挂与下拉。',
  },
  {
    match: 'lat pulldown',
    rating: 4,
    level: '入门',
    scheme: '3–4 组 × 10–12 次，组间 90 秒',
    howto: [
      '坐稳，大腿卡在垫下，握距略宽于肩。',
      '肩胛下沉，把手肘向身体两侧下方拉。',
      '杠拉到锁骨附近，胸口微抬。',
      '控制回到手臂完全伸展、肩胛被拉上去的位置。',
    ],
    cues: ['不要后仰用体重压。', '想象肘尖插进裤兜。', '回程让背阔肌被拉长，不要停在半程。'],
    feel: '腋下发紧、背部有"展开"感。若前臂先力竭，试着用助力带。',
    caution: '颈后下拉不要做，对肩关节不友好。',
  },
  {
    match: 'barbell bent over row',
    rating: 5,
    level: '中级',
    scheme: '4 组 × 6–10 次，组间 2 分钟',
    howto: [
      '髋铰链俯身约 45°，背部绷平，杠自然垂在膝前。',
      '肩胛先后缩，再把杠拉向肚脐方向。',
      '顶点肘部超过身体，背部收紧停一下。',
      '控制下放到手臂伸直、肩胛前伸。',
    ],
    cues: ['全程脊柱中立，不要用腰"甩"起重量。', '拉的时候屏住呼吸收紧核心。', '躯干角度固定，别越拉越直。'],
    feel: '两块肩胛骨之间收紧，背阔肌外侧发力。',
    caution: '腰不好可用胸支撑划船或坐姿绳索划船替代。',
  },
  {
    match: 'overhead press',
    rating: 4,
    level: '中级',
    scheme: '4 组 × 6–8 次，组间 2 分钟',
    howto: [
      '杠置于锁骨前，握距略宽于肩，前臂垂直。',
      '收紧臀腹，肋骨不要外翻。',
      '把头略后收让杠"擦"过下巴，垂直向上推。',
      '推到手臂伸直、杠在头顶正上方，再原路下放。',
    ],
    cues: ['核心越稳，推得越多。', '不要用腿蹬（那是借力推举）。', '顶点肩胛向上"送出"。'],
    feel: '肩膀外侧与前束发力，斜方肌上部最后收紧。',
    caution: '肩峰撞击史者改用哑铃中立握；腰不适者坐姿做。',
  },
  {
    match: 'lateral raise',
    rating: 4,
    level: '入门',
    scheme: '3–4 组 × 12–15 次，组间 60–90 秒',
    howto: [
      '站直或坐直，哑铃垂于体侧，肘微屈固定。',
      '以肩为轴把手臂向两侧抬起，手肘领先于手腕。',
      '抬到与肩同高，小指略高于拇指。',
      '用 2–3 秒缓慢下放。',
    ],
    cues: ['重量宁轻，肩不能耸。', '不要甩，全程控制。', '抬到肩高就够，再高就变成斜方肌了。'],
    feel: '肩膀最外侧（像给肩膀"加宽"的位置）发紧。若脖子先酸，减小重量。',
    caution: '肩痛时把幅度限制在无痛区间，或改做绳索侧平举。',
  },
  {
    match: 'dumbbell curl',
    rating: 4,
    level: '入门',
    scheme: '3 组 × 10–12 次，组间 60 秒',
    howto: ['站直，哑铃自然下垂，掌心向前或中立。', '大臂贴住体侧，只屈肘把哑铃举起。', '顶点主动收缩二头肌，不要甩上去。', '用 2–3 秒下放到手臂伸直。'],
    cues: ['手肘不前移。', '手腕保持中立。', '重量服从动作，别让动作服从重量。'],
    feel: '大臂前侧鼓起、变硬。若肩膀前侧代偿，说明重量过大。',
    caution: '肘部有不适时改做锤式弯举（中立握）。',
  },
  {
    match: 'triceps pushdown',
    rating: 4,
    level: '入门',
    scheme: '3 组 × 12–15 次，组间 60 秒',
    howto: ['面对绳索站立，手肘固定在体侧。', '只伸肘把绳压下，底部两手略分开。', '顶点停 1 秒，感受三头肌收紧。', '控制回程到前臂约 90°。'],
    cues: ['大臂像被夹住一样不动。', '躯干不要前后晃。', '底部完全伸直但不要锁死。'],
    feel: '手肘后侧的三头肌发紧，越到末端越明显。',
    caution: '肘部疼痛时减小重量、缩小幅度。',
  },
  {
    match: 'face pull',
    rating: 5,
    level: '入门',
    scheme: '3 组 × 15–20 次，组间 60 秒',
    howto: ['绳索调到面部高度，双手握绳两端。', '肩胛后缩，把绳拉向眉心两侧。', '顶点双手向外打开，肩胛夹紧。', '缓慢回到手臂伸展。'],
    cues: ['用轻重量、高次数。', '专注"肩胛后缩 + 外旋"。', '这是姿势与肩健康的动作，不是力量动作。'],
    feel: '肩后侧与上背中间收紧，前三角不应参与太多。',
    caution: '几乎人人适合，久坐办公人群优先安排。',
  },
  {
    match: 'goblet squat',
    rating: 5,
    level: '入门',
    scheme: '3–4 组 × 10–12 次，组间 90 秒',
    howto: ['双手抱哑铃或壶铃于胸前，肘朝下。', '脚略宽于肩，脚尖外展。', '保持胸口向上，坐进两腿之间下蹲。', '蹲到大腿接近平行，脚跟压地起身。'],
    cues: ['壶铃像配重：它让你自然坐直。', '膝盖顺脚尖推开。', '下蹲到底部停一下，练活动度。'],
    feel: '大腿前侧与臀部同时发力，躯干比杠铃深蹲更直立。',
    caution: '膝痛者减小深度，加宽站距。',
  },
  {
    match: 'leg press',
    rating: 4,
    level: '入门',
    scheme: '3–4 组 × 10–15 次，组间 90 秒',
    howto: ['背部与臀部完全贴住靠垫，脚与肩同宽踩踏板。', '解锁安全扣，缓慢屈膝下放到膝约 90° 或更深。', '脚掌均匀发力推回，膝盖不锁死。', '保持腰不离垫。'],
    cues: ['屁股不能离开靠垫（那是腰椎代偿）。', '膝盖别内扣。', '下放时控制，不要靠反弹。'],
    feel: '大腿前侧主导，脚位置越低臀腿越参与。',
    caution: '不要追求超大幅度，膝腰都在风险区。',
  },
  {
    match: 'hip thrust',
    rating: 5,
    level: '入门',
    scheme: '3–4 组 × 10–12 次，组间 90 秒',
    howto: ['上背靠在长凳边缘，杠铃置于髋部（垫护垫）。', '脚踩地面，膝约 90°。', '夹臀把髋顶到躯干与大腿成一条线。', '顶点停 1–2 秒，缓慢下放。'],
    cues: ['顶点收下巴、肋骨下沉。', '用臀发力而不是腰。', '小腿保持垂直地面。'],
    feel: '臀部中间强烈收缩，是臀肌最直接的孤立动作。',
    caution: '髋部不适可改做臀桥；腰不适多是顶端过度后仰导致。',
  },
  {
    match: 'plank',
    rating: 4,
    level: '入门',
    scheme: '3 组 × 30–60 秒',
    howto: ['肘在肩正下方，前臂撑地。', '收紧腹部与臀部，身体成一条直线。', '保持均匀呼吸，别憋气。', '撑到姿势开始变形就停。'],
    cues: ['屁股不要翘、腰不要塌。', '主动把肘往脚尖方向"推"。', '质量优先于时长。'],
    feel: '腹部深层像被束紧，同时臀部与背一起稳定。',
    caution: '腰不适者改做死虫式（dead bug）。',
  },
  {
    match: 'leg curl',
    rating: 4,
    level: '入门',
    scheme: '3 组 × 12–15 次，组间 60–90 秒',
    howto: ['俯卧或坐姿，滚垫置于脚踝上方。', '固定髋部，屈膝把垫拉向臀部。', '顶点停 1 秒。', '用 3 秒缓慢回到起始。'],
    cues: ['髋不要抬离垫子。', '回程慢，离心是重点。', '脚尖勾起能增加腘绳肌参与。'],
    feel: '大腿后侧靠膝盖处收紧。',
    caution: '膝后侧不适时减小重量与幅度。',
  },
  {
    match: 'calf raise',
    rating: 4,
    level: '入门',
    scheme: '4 组 × 12–20 次，组间 60 秒',
    howto: ['前脚掌踩在台阶边缘，脚跟悬空。', '缓慢下放到脚跟低于台阶（拉长）。', '踮到最高点，停 1 秒。', '全程膝盖保持微屈固定。'],
    cues: ['幅度比重量重要。', '慢下快上，顶点停顿。', '不要靠弹震。'],
    feel: '小腿后侧靠上位置鼓起变硬。',
    caution: '跟腱炎患者幅度减半。',
  },
]

// ---------------------------------------------------------------------------
// Pattern rules — matched on the (lowercased) exercise name.
// ---------------------------------------------------------------------------

const PATTERNS = [
  { re: /push[- ]?up/, feel: '胸和肱三头同时发力，身体像一块板子整体升降。', caution: '腰塌说明核心没收紧，先做跪姿版本。', rating: 4 },
  { re: /dip\b/, feel: '身体前倾多一点偏胸，直立偏三头。', caution: '肩前侧有痛感时不要下得太深。', rating: 4 },
  { re: /fly|pec deck|crossover/, feel: '手肘微屈固定，像"抱一棵大树"，胸中间被挤压。', caution: '重量轻，别让肩关节被拉开。', rating: 4 },
  { re: /shrug/, feel: '肩膀垂直向上提，不要转圈。', caution: '幅度小、停顿足即可。', rating: 3 },
  { re: /lunge|split squat|step[- ]?up/, feel: '前腿臀部与大腿发力，后腿只是支撑。', caution: '膝盖别超过脚尖太多，重心在两腿之间。', rating: 4 },
  { re: /bulgarian/, feel: '重心压在前腿，臀部拉伸感明显。', caution: '平衡不稳时先扶固定物。', rating: 4 },
  { re: /good morning/, feel: '髋铰链，腿后侧拉长；腰只是稳定。', caution: '重量必须轻，动作错了很伤腰。', rating: 3 },
  { re: /kettlebell swing/, feel: '髋部爆发伸展把壶铃"甩"出去，手臂只是绳子。', caution: '不是深蹲、不是用手抬。', rating: 4 },
  { re: /crunch|sit[- ]?up/, feel: '腹部缩短，肋骨向骨盆靠。', caution: '别用手抱头硬拉脖子。', rating: 3 },
  { re: /leg raise|hanging/, feel: '下腹发力把骨盆卷起来。', caution: '腰离地说明超出能力，改屈膝。', rating: 4 },
  { re: /russian twist/, feel: '旋转来自胸椎，腰侧收紧。', caution: '腰椎不适者避免负重旋转。', rating: 3 },
  { re: /cable woodchop|pallof/, feel: '抗旋转：身体要"顶住"不被拉动。', caution: '轻重量、慢速、保持骨盆稳定。', rating: 4 },
  { re: /hyperextension|back extension/, feel: '臀部与竖脊肌一起把躯干拉起。', caution: '顶端不要过度后仰。', rating: 3 },
  { re: /farmer|suitcase carry/, feel: '握力、斜方肌与核心同时工作。', caution: '肩膀下沉不要耸起。', rating: 4 },
  { re: /wall sit/, feel: '大腿前侧等长收缩发热。', caution: '膝盖不超过脚尖，背部贴墙。', rating: 3 },
  { re: /stretch|mobility|yoga/, feel: '拉到"紧但不痛"的位置，呼吸放松。', caution: '不要弹震拉伸。', rating: 3 },
  { re: /bench|chest press/, feel: '胸肌把手肘往中间夹。', caution: '肩胛始终后缩下沉。', rating: 4 },
  { re: /row/, feel: '肩胛先动，背再拉。', caution: '别用腰甩。', rating: 4 },
  { re: /squat/, feel: '坐进两腿之间，臀腿一起发力。', caution: '膝顺脚尖方向。', rating: 4 },
  { re: /deadlift/, feel: '髋铰链，腿后侧与臀部主导。', caution: '背部保持中立。', rating: 4 },
  { re: /press|shoulder/, feel: '肩部垂直推起，核心稳住肋骨。', caution: '不要塌腰后仰。', rating: 4 },
  { re: /curl/, feel: '屈肘，只有前臂在动。', caution: '别甩重量。', rating: 4 },
  { re: /extension|pushdown|kickback/, feel: '伸肘，大臂固定。', caution: '肘部不要晃。', rating: 4 },
  { re: /raise/, feel: '肩为轴，控制幅度。', caution: '别耸肩。', rating: 3 },
  { re: /plank|hold|isometric/, feel: '等长收缩，姿势不变形最重要。', caution: '到姿势变形就停。', rating: 4 },
  { re: /run|jog|treadmill|bike|cycle|elliptical|rower|jump rope/, feel: '心肺主导，能说话但不能唱歌的强度最合适。', caution: '循序渐进，注意鞋与地面。', rating: 3 },
  { re: /jump|hop|bound|plyo/, feel: '落地轻、膝盖软，爆发来自髋。', caution: '疲劳时不要做，先掌握落地。', rating: 3 },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const norm = s => pad(s).toLowerCase()

/** A stable 0-1 hash so fallback numbers do not jump between renders. */
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 4294967295
}

const MUSCLE_KEY = {
  chest: 'chest', 'upper back': 'upper-back', lats: 'upper-back', back: 'upper-back',
  shoulders: 'deltoids', delts: 'deltoids', deltoids: 'deltoids',
  biceps: 'biceps', triceps: 'triceps', forearms: 'forearm', forearm: 'forearm',
  abs: 'abs', core: 'abs', abdominals: 'abs', obliques: 'obliques',
  glutes: 'gluteal', quadriceps: 'quadriceps', quads: 'quadriceps',
  hamstrings: 'hamstring', calves: 'calves', traps: 'trapezius', trapezius: 'trapezius',
  adductors: 'adductors', 'lower back': 'lower-back', spine: 'lower-back',
  'hip flexors': 'hip-flexors', shins: 'tibialis', 'serratus anterior': 'serratus',
}

export const muscleKeyOf = ex => {
  const raw = norm(ex?.mg || ex?.tg)
  return MUSCLE_KEY[raw] || null
}

/**
 * Full coaching payload for one exercise.
 * @param {object} ex catalogue entry ({id, n, mg, tg, sm, eq, cat})
 * @returns {{howto: string[], cues: string[], feel: string, caution: string, rating: number, level: string, scheme: string, source: string}}
 */
export function guideFor(ex) {
  const name = norm(ex?.n)
  const curated = CURATED.find(c => name.includes(c.match))
  const muscle = muscleKeyOf(ex)
  const mg = MUSCLE_GUIDE[muscle] || null
  const pattern = PATTERNS.find(p => p.re.test(name))
  const r = hash(String(ex?.id || name))

  const eq = norm(ex?.eq)
  const isMachine = /machine|smith|cable/.test(eq) || /machine|smith|cable/.test(name)
  const isBodyweight = eq === 'body weight' || eq === 'bodyweight' || eq === ''
  const level = curated?.level || (isMachine || isBodyweight ? '入门' : '中级')

  const scheme = curated?.scheme || (
    ex?.cat === 'cardio' ? '20–40 分钟，中等强度'
      : /stretch|mobility|yoga/.test(norm(ex?.cat)) ? '每个动作 30–45 秒 × 2 轮'
        : isMachine ? '3 组 × 12–15 次，组间 60–90 秒'
          : isBodyweight ? '3 组 × 8–15 次（力竭前 1–2 次）'
            : '3–4 组 × 8–12 次，组间 90 秒'
  )

  const howto = curated?.howto || [
    `调整器械或站位，先用轻重量完成 8–10 次找到动作轨迹（${ex?.eq || '自重'}）。`,
    mg ? `身体姿态服务于目标：这个动作主要${mg.action}。` : '保持脊柱中立，动作在可控范围内完成。',
    '下放阶段用 2–3 秒控制，避免借力与反弹。',
    '完成计划次数后，用同样的轨迹缓慢还原。',
  ]

  const cues = curated?.cues || [
    mg?.cue || '全程控制，宁可轻一点也不要让动作变形。',
    '呼吸：发力时呼气，回程吸气，大重量时先吸气绷紧核心。',
    '把注意力放在目标肌肉上，而不是"把重量举起来"。',
  ]

  const feel = curated?.feel || mg?.feel || pattern?.feel
    || '先减轻重量，用慢速（3 秒下放）做 8 次，最容易找到目标肌肉的张力。'

  const caution = curated?.caution || pattern?.caution
    || (isBodyweight ? '自重动作也要控制节奏，别靠惯性完成。' : '任何关节出现刺痛都立刻停止，换成无痛范围内的变式。')

  // Recommendation: compounds that train a lot of muscle per unit of risk score highest;
  // machine isolation is safe but narrow; stretching and plyometrics sit lower for strength goals.
  let rating = curated?.rating ?? pattern?.rating ?? 3
  if (!curated) {
    if (/barbell|dumbbell/.test(eq) && (ex?.sm?.length || 0) >= 2) rating = 4
    if (/machine|cable/.test(eq)) rating = Math.min(rating, 4)
    if (/stretch|mobility|yoga/.test(norm(ex?.cat))) rating = 3
    if (/cardio/.test(norm(ex?.cat))) rating = 3
  }
  if (r > 0.94) rating = Math.min(5, rating + 1)

  return {
    howto, cues, feel, caution,
    rating: Math.max(1, Math.min(5, rating)),
    level, scheme,
    source: curated ? 'expert' : pattern ? 'pattern' : 'muscle',
  }
}

/** Which muscles move the weight, and which merely help — as display rows. */
export function involvementOf(ex) {
  const primary = []
  const secondary = []
  const add = (list, raw) => {
    const key = MUSCLE_KEY[norm(raw)]
    if (key && !list.includes(key)) list.push(key)
  }
  add(primary, ex?.mg || ex?.tg)
  for (const s of ex?.sm || []) add(secondary, s)
  return { primary, secondary: secondary.filter(m => !primary.includes(m)) }
}
