'use strict';
const { config } = require('./config');

/**
 * 调用 DeepSeek（OpenAI 兼容接口）。无 key 或调用失败时返回 null，
 * 由上层走“学科模板兜底”，保证离线可运行。
 */
async function callDeepSeek(system, user, expectJson = true) {
  if (!config.DEEPSEEK_API_KEY) return null;
  try {
    const body = {
      model: config.DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.7,
    };
    if (expectJson) body.response_format = { type: 'json_object' };
    const r = await fetch(`${config.DEEPSEEK_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const c = j.choices?.[0]?.message?.content;
    if (!c) return null;
    return expectJson ? JSON.parse(c) : c;
  } catch (e) {
    return null;
  }
}

const SUBJECT_INTRO = {
  数学: '先理解概念与适用场景，再掌握标准解题步骤，最后通过典型例题形成方法。',
  语文: '从字词积累、语境理解到表达运用逐步深入，注重语感与逻辑。',
  英语: '围绕“词义—句型—语用”三层递进，结合例句与语境记忆。',
  物理: '建立“模型—公式—单位—推导”的思维链，重视受力分析与过程拆解。',
  化学: '抓住“物质—性质—变化—守恒”主线，强化方程式与实验现象。',
  生物: '以“结构—功能—调节”为核心，建立生命系统的整体观。',
  历史: '按“背景—事件—影响”梳理，培养因果与时空观念。',
  地理: '结合“位置—特征—成因—人地关系”进行分析。',
  政治: '从“概念—原理—时政—价值”四个层面理解与应用。',
};

/** 知识点自动生成：返回 { explanation, example } */
async function generateKnowledgePoint(subject, grade, topic) {
  const sys = `你是中小学全科智能助教。请针对指定学科、年级与知识点，输出 JSON：{ "explanation": "知识点讲解(200字内,条理清晰)", "example": "一道典型例题及规范解答" }。只输出 JSON。`;
  const usr = `学科：${subject}；年级：${grade}；知识点：${topic}。`;
  const ai = await callDeepSeek(sys, usr, true);
  if (ai && ai.explanation && ai.example) return { explanation: ai.explanation, example: ai.example };

  // 兜底：学科模板
  const intro = SUBJECT_INTRO[subject] || `「${topic}」是${grade}年级应掌握的内容，建议先理解概念，再通过练习形成方法，最后归纳易错点。`;
  const explanation = `【${subject} · ${grade}年级】${topic}\n${intro}`;
  const example = `【典型例题】关于「${topic}」的示例：\n题：请运用本知识点解决一个实际问题。\n解：① 明确已知与所求；② 选用合适方法；③ 规范书写步骤；④ 检验结果。\n（平台已自动生成基础讲解；登录后可由能力用户补充更优思路）`;
  return { explanation, example };
}

/** 自适应讲解：依据学习者等级(L1-L5)改写讲解难度 */
async function tailorExplanation(kp, level) {
  const sys = `你是因材施教的智能助教。请基于学习者能力等级，把知识点讲解改写为合适难度。输出 JSON：{ "tailored": "改写后的讲解" }。只输出 JSON。`;
  const usr = `知识点：${kp.topic}（${kp.subject} ${kp.grade_level}年级）\n原始讲解：${kp.explanation}\n学习者等级：${level}（L1启蒙～L5精通）。要求：L1-L2用生活化比喻、短句；L3-L4标准；L5补充拓展与易错点。`;
  const ai = await callDeepSeek(sys, usr, true);
  if (ai && ai.tailored) return ai.tailored;

  // 兜底
  if (level === 'L1' || level === 'L2') {
    return `（通俗版）${kp.topic} 其实不难：把它想成生活里的一件小事——${kp.explanation}`;
  }
  if (level === 'L4' || level === 'L5') {
    return `${kp.explanation}\n\n【进阶提示】注意该知识点常与相近概念混淆，建议对比练习、总结通法。`;
  }
  return kp.explanation;
}

/** 自成长：为某知识点生成一条新思路（当现有思路不足或被低分时触发） */
async function generateApproach(kp, categoryHint) {
  const sys = `你是解题方法专家。针对一个知识点，补充一条新的解题/理解思路。输出 JSON：{ "title": "思路名称", "content": "思路详述(含步骤)", "category": "方法类别" }。只输出 JSON。`;
  const usr = `知识点：${kp.topic}（${kp.subject} ${kp.grade_level}年级）\n已有思路提示：${categoryHint || '无'}。请给出一个不同角度的思路。`;
  const ai = await callDeepSeek(sys, usr, true);
  if (ai && ai.title && ai.content) return ai;
  return {
    title: '拓展思路（平台自生成）',
    content: `从另一个角度理解「${kp.topic}」：先抓住核心关系，再换一种表征方式重新组织已知条件，往往能避开复杂运算。`,
    category: '综合',
  };
}

/** 补充测评题（可选增强，无 key 时返回空，使用种子题库） */
async function generateAssessmentQuestions(grade, subject) {
  const sys = `你是出题专家。输出 JSON：{ "questions": [ { "question":"题干", "options":["A","B","C","D"], "answer": 0 } ] }。只输出 JSON。`;
  const usr = `为${grade}年级${subject}学科出 3 道选择题（answer 为正确选项下标 0-3）。`;
  const ai = await callDeepSeek(sys, usr, true);
  if (ai && Array.isArray(ai.questions)) return ai.questions;
  return [];
}

module.exports = { callDeepSeek, generateKnowledgePoint, tailorExplanation, generateApproach, generateAssessmentQuestions };
