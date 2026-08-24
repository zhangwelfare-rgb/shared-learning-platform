# 📚 智学论坛 · 自学习智能体（Shared Learning Platform）

一个**类论坛的自学习智能体网站**，面向小初高（K12）各学科知识点与解题技巧的获取、分享与输出。

> 平台像一名持续成长的 AI 家教：自动生成知识点 → 能力用户分享思路赚积分 → 学习用户按年级测评、按能力等级匹配最契合的解题思路（如「已知 xy=20，求 3x+4y 的最小值」给出代入 / 换元 / 基本不等式 / 赋值等不同思路）→ 反馈驱动平台自学习、自成长，逐步替代家教。

---

## ✨ 核心功能（五大模块）

| # | 功能 | 说明 |
|---|------|------|
| 1 | **知识点自动生成（智能体）** | 依据学科 / 年级 / 知识点主题自动生成讲解 + 典型例题。已接入 DeepSeek；未配置 Key 时自动走学科模板兜底，可完整离线运行 |
| 2 | **能力用户分享与采纳** | 注册为「能力用户」即可发布解题思路；被学习用户「采纳」即赚取积分；平台按学科 / 年级 / 方法类别分类整理沉淀 |
| 3 | **分级测评 + 自适应匹配** | 学习用户按年级 + 自定义评比标准（准确率 / 速度 / 广度 / 综合）测评，划分 L1–L5 能力等级；平台据此 + 历史反馈匹配最合适的思路，并输出**自适应难度讲解** |
| 4 | **积分经济体系** | 赚取（采纳、注册奖励）、消耗（学习思路）、人民币购买套餐、积分 ⇄ 人民币双向兑换，全部流水可查 |
| 5 | **平台自学习、自成长** | 学习用户的评分与采纳反馈不断重排思路匹配度；思路不足或被低分时，智能体自动补充新思路（`/agent/autoGrow`），逐步逼近“替代家教” |

---

## 🧱 技术栈

- **后端**：Node.js（≥22，使用内置 `node:sqlite`，无需原生编译）+ Express + JWT（jsonwebtoken）+ bcryptjs
- **前端**：原生 HTML / CSS / JS 单页应用（无构建步骤）
- **AI 智能体**：DeepSeek（OpenAI 兼容接口），无 Key 时使用内置学科模板
- **存储**：SQLite（`data/app.db`，自动创建）

> 为什么用 `node:sqlite`：零原生依赖、无需编译，`npm install` 后即可运行。

---

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. （可选）配置环境变量
cp .env.example .env
#    编辑 .env：填入 DEEPSEEK_API_KEY 可启用真实 AI 生成；不填也能完整运行

# 3. 初始化演示数据（演示账号、示例知识点、测评题库）
npm run seed

# 4. 启动
npm start
```

打开 http://localhost:3000

**演示账号**

| 账号 | 密码 | 角色 |
|------|------|------|
| teacher | teacher123 | 能力用户（分享思路赚积分） |
| student | student123 | 学习用户（测评 / 学思路） |
| admin | admin123 | 管理员 |

---

## 📁 目录结构

```
├─ server/
│  ├─ index.js      # 入口：Express + 静态资源 + 路由挂载
│  ├─ config.js     # 配置（端口/JWT/兑换比例/套餐/积分规则）
│  ├─ db.js         # node:sqlite 建表与事务封装
│  ├─ auth.js       # bcrypt 密码 + JWT 鉴权中间件
│  ├─ ai.js         # AI 智能体：知识点生成 / 自适应讲解 / 思路自成长（含兜底）
│  ├─ routes.js     # 全部 REST API
│  └─ seed.js       # 种子数据
├─ public/          # 前端单页应用（HTML/CSS/JS）
├─ data/            # SQLite 数据库（git 忽略）
├─ .env.example
└─ package.json
```

---

## 🔌 API 概览

**认证**：`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`

**知识点**：`GET /api/knowledge` · `GET /api/knowledge/:id` · `POST /api/knowledge/generate`（智能体生成）· `POST /api/knowledge`

**思路（论坛）**：`GET /api/approaches` · `POST /api/approaches`（能力用户）· `POST /api/approaches/:id/study`（消耗积分）· `POST /api/approaches/:id/feedback`（评分/采纳，奖励作者）

**测评与匹配**：`GET /api/assessment/questions` · `POST /api/assessment/submit`（定级 L1–L5）· `POST /api/agent/match`（自适应匹配）· `POST /api/agent/autoGrow`（平台自成长）

**积分**：`GET /api/points/me` · `GET /api/points/transactions` · `GET /api/points/packages` · `POST /api/points/purchase` · `POST /api/points/exchange` · `GET /api/stats/leaderboard`

**元信息**：`GET /api/meta`

---

## 🧠 自学习机制说明

1. **反馈闭环**：学习用户对每条思路给出 1–5 分「融会贯通度」评分并标记是否采纳 → 平台实时更新思路质量分与采纳数。
2. **自适应匹配**：`/agent/match` 依据用户测评等级重排思路——L1/L2 优先推送更短更易懂的入门思路，L4/L5 优先推送高评分深度思路，并同步输出按等级改写的「自适应讲解」。
3. **平台自成长**：当某知识点思路偏少或被低分时，可触发 `/agent/autoGrow`，由 AI 从新角度补写一条思路，充实知识库。
4. **经济闭环**：采纳 → 作者赚积分；学习 → 消耗积分；积分可由人民币购买/兑换——优质贡献者获得激励，内容持续变好。

---

## 🛠 自定义配置（.env）

| 变量 | 默认 | 说明 |
|------|------|------|
| PORT | 3000 | 服务端口 |
| JWT_SECRET | 开发默认值 | 生产环境务必修改 |
| DB_PATH | ./data/app.db | 数据库路径 |
| DEEPSEEK_API_KEY | 空 | 留空使用模板兜底 |
| DEEPSEEK_BASE / DEEPSEEK_MODEL | api.deepseek.com / deepseek-chat | 大模型接入 |
| EXCHANGE_RATE | 10 | 1 元人民币 = 10 积分 |
| SIGNUP_BONUS / DEMO_RMB | 20 / 50 | 注册奖励积分 / 演示人民币余额 |
| STUDY_COST / ADOPT_REWARD | 3 / 10 | 学习一次消耗积分 / 思路被采纳奖励积分 |

---

## 📄 许可证

MIT
