'use strict';
const { db, now } = require('./db');
const { config } = require('./config');
const { hashPassword } = require('./auth');

const uCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (uCount > 0) {
  console.log('ℹ️  已存在数据，跳过种子初始化（如需重置请清空 data/ 目录后重试）。');
  process.exit(0);
}

function ins(stmt, params) { return Number(stmt.run(...params).lastInsertRowid); }

const teacherId = ins(db.prepare('INSERT INTO users (username,password_hash,role,grade,points,rmb_balance,created_at) VALUES (?,?,?,?,?,?,?)'),
  ['teacher', hashPassword('teacher123'), 'capable', null, 60, config.DEMO_RMB, now()]);
const studentId = ins(db.prepare('INSERT INTO users (username,password_hash,role,grade,points,rmb_balance,created_at) VALUES (?,?,?,?,?,?,?)'),
  ['student', hashPassword('student123'), 'learner', 7, 30, config.DEMO_RMB, now()]);
ins(db.prepare('INSERT INTO users (username,password_hash,role,grade,points,rmb_balance,created_at) VALUES (?,?,?,?,?,?,?)'),
  ['admin', hashPassword('admin123'), 'admin', null, 0, config.DEMO_RMB, now()]);

// ---- 知识点 + 思路 ----
const kp = (subject, grade, topic, explanation, example, unit = null, exam_focus = null) =>
  ins(db.prepare('INSERT INTO knowledge_points (subject,grade_level,unit,topic,explanation,example,exam_focus,source,created_by,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'),
    [subject, grade, unit, topic, explanation, example, exam_focus, 'ai', teacherId, 'active', now()]);
const ap = (kpId, title, content, category) =>
  ins(db.prepare('INSERT INTO approaches (kp_id,title,content,category,author_id,created_at) VALUES (?,?,?,?,?,?)'),
    [kpId, title, content, category, teacherId, now()]);

// 头条示例：已知 xy=20，求 3x+4y 的最小值（多思路）
const k1 = kp('数学', 7, '已知 xy=20，求 3x+4y 的最小值',
  '这是“已知两数乘积、求线性组合最值”的经典问题（x,y>0）。核心是把二元转化为一元，或用不等式放缩。',
  '【题】已知 x>0, y>0 且 xy=20，求 3x+4y 的最小值。\n【解】以下提供代入、换元、基本不等式、赋值四种思路，详见“思路”区。');
ap(k1, '代入法', '由 xy=20 得 y=20/x，代入目标式：f(x)=3x+4·(20/x)=3x+80/x。对 x>0，用基本不等式：3x+80/x ≥ 2√(3x·80/x)=2√240≈30.98，当 3x=80/x 即 x≈5.16 时取等。', '代入');
ap(k1, '换元法', '令 x=√20·t，则 y=√20/t（t>0），于是 3x+4y=√20(3t+4/t) ≥ √20·2√(3t·4/t)=√20·2√12=2√240≈30.98。换元后结构更对称。', '换元');
ap(k1, '基本不等式法（最巧妙）', '3x+4y ≥ 2√(3x·4y)=2√(12xy)=2√240=8√15≈30.98，等号当且仅当 3x=4y。结合 xy=20 可解出 x=√(80/3), y=√(45/4)。一步到位。', '不等式');
ap(k1, '赋值法（快速估算）', '取整数对验证：x=4,y=5→32；x=5,y=4→31；x=2,y=10→46；可见最小值在 31 附近，再用不等式精确化。适合快速估算与检验。', '赋值');

const k2 = kp('数学', 9, '一元二次方程求根公式',
  '对 ax²+bx+c=0 (a≠0)，求根公式为 x=[-b±√(b²−4ac)]/(2a)。判别式 Δ=b²−4ac 决定根的情况。',
  '【题】解 x²−5x+6=0。\n【解】a=1,b=−5,c=6，Δ=25−24=1>0，x=(5±1)/2 → x₁=3, x₂=2。');
ap(k2, '配方法', '两边除以 a，移项，配方：(x+b/2a)²=(b²−4ac)/4a²，开方即得公式。配方法是公式法的来源，理解它就不必死记。', '配方');
ap(k2, '因式分解法', '若能十字相乘分解为 (x−m)(x−n)=0，则根为 m,n。如 x²−5x+6=(x−2)(x−3)=0，根 2、3。优先尝试分解，更快。', '因式分解');

const k3 = kp('语文', 5, '比喻修辞手法',
  '比喻用跟甲事物相似的乙事物说明甲事物，含本体、喻体、喻词三要素。',
  '【例】“弯弯的月亮像小船。”本体=月亮，喻体=小船，喻词=像。');
ap(k3, '明喻/暗喻/借喻辨析', '明喻带“像、如”；暗喻用“是、成为”；借喻直接以喻体代本体，如“忽如一夜春风来，千树万树梨花开”以梨花喻雪。', '修辞辨析');
ap(k3, '比喻的作用', '使抽象变具体、深奥变浅显，增强画面感与感染力。写作中恰当使用能让读者“看得见”。', '表达作用');

const k4 = kp('英语', 6, '一般过去时',
  '一般过去时表示过去发生的动作或状态，规则动词加 -ed，不规则动词需记忆，常搭配 yesterday/last week。',
  'I went to the park yesterday.');
ap(k4, '规则与不规则动词', '规则：play→played；不规则：go→went, eat→ate。建议按语义分组记忆，避免混背。', '词汇');
ap(k4, '句式变换', '否定加 didn’t + 动词原形；疑问 Did + 主语 + 原形？如 Did you go?', '语法');

const k5 = kp('物理', 8, '速度公式 v=s/t 的应用',
  '速度 v=s/t，s 为路程，t 为时间。匀速直线运动速度不变。',
  '小车 10s 行驶 100m，v=100/10=10 m/s。');
ap(k5, '单位换算', '注意 km/h 与 m/s：1 m/s=3.6 km/h。先统一单位再代入，少犯错。', '计算');
ap(k5, '图像法', 's-t 图斜率即速度；v-t 图面积即路程。用图像辅助理解更直观。', '图像');

const k6 = kp('数学', 3, '分数加减法',
  '同分母分数相加减，分母不变、分子相加减；异分母先通分再计算。',
  '1/4+2/4=3/4；1/2+1/3=3/6+2/6=5/6。');
ap(k6, '通分技巧', '找分母最小公倍数作公分母，分子相应扩大后再加减。', '通分');
ap(k6, '生活化理解', '把披萨平均分成若干份，数一数拿走几份，直观好懂，先建立“份数”直觉再学规则。', '直观');

// ---- 测评题库 ----
const bank = [
  [3, '数学', '计算 1/2 + 1/2 = ?', ['0', '1', '2', '1/4'], 1],
  [3, '语文', '下列哪个是表示颜色的词？', ['跑步', '红色', '快乐', '因为'], 1],
  [5, '语文', '“弯弯的月亮像小船”用了什么修辞？', ['比喻', '拟人', '夸张', '排比'], 0],
  [5, '数学', '12 × 5 = ?', ['50', '55', '60', '65'], 2],
  [6, '英语', 'I ___ to the park yesterday.', ['go', 'goes', 'went', 'going'], 2],
  [6, '数学', '求 3x=12 中 x 的值', ['3', '4', '9', '36'], 1],
  [7, '数学', '已知 x+y=10, x−y=4，则 x=?', ['3', '5', '7', '8'], 2],
  [7, '数学', '化简 2(a+3)=?', ['2a+3', '2a+6', 'a+6', '2a'], 1],
  [8, '物理', '速度公式 v=s/t 中，s 表示？', ['速度', '时间', '路程', '加速度'], 2],
  [8, '数学', '直角三角形两直角边 3 和 4，斜边为？', ['5', '6', '7', '12'], 0],
  [9, '数学', 'x²−5x+6=0 的根是？', ['2,3', '−2,−3', '1,6', '无实根'], 0],
  [9, '物理', '牛顿第一定律又称？', ['惯性定律', '万有引力', '能量守恒', '动量守恒'], 0],
  [10, '数学', '函数 y=2x+1 的斜率是？', ['0', '1', '2', '3'], 2],
  [11, '数学', 'sin(30°)=?', ['0', '1/2', '√3/2', '1'], 1],
  [12, '物理', '自由落体加速度 g 约？', ['9.8', '3.14', '1.6', '0'], 0],
];
const stmtB = db.prepare('INSERT INTO assessment_bank (grade,subject,question,options,answer,difficulty) VALUES (?,?,?,?,?,?)');
bank.forEach(([g, s, q, o, a]) => stmtB.run(g, s, q, JSON.stringify(o), a, 2));

// ---- 标准课程库：各学段各学科知识点 + 考点 ----
const curriculum = [
  ...require('./data/primary'),
  ...require('./data/junior'),
  ...require('./data/senior'),
];
const stmtCur = db.prepare('INSERT INTO knowledge_points (subject,grade_level,unit,topic,explanation,example,exam_focus,source,created_by,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
let curCount = 0;
for (const c of curriculum) {
  stmtCur.run(c.s, c.g, c.u, c.t, c.e, c.x, c.k, 'curriculum', null, 'active', now());
  curCount++;
}

console.log('✅ 种子数据初始化完成。');
console.log(`   标准课程库已写入 ${curCount} 条知识点/考点（小初高 12 个年级 × 各学科）。`);
console.log('   演示账号：teacher / teacher123（能力用户）  student / student123（学习用户）  admin / admin123');
