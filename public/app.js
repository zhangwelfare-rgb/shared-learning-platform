/* 智学论坛 · 自学习智能体 前端逻辑 */
const App = (() => {
  const LS_TOKEN = 'sl_token', LS_USER = 'sl_user';
  let token = localStorage.getItem(LS_TOKEN) || '';
  let user = JSON.parse(localStorage.getItem(LS_USER) || 'null');
  let meta = { subjects: [], packages: [], exchangeRate: 10 };
  let view = 'home';
  let currentKp = null;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (id) => document.getElementById(id);

  async function api(method, path, body) {
    const opt = { method, headers: {} };
    if (token) opt.headers['Authorization'] = 'Bearer ' + token;
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch('/api' + path, opt);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('请求失败 ' + r.status));
    return data;
  }

  function toast(msg) {
    const t = el('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }
  function openModal(title, html) {
    el('authTitle').textContent = title;
    el('authBody').innerHTML = html;
    el('authModal').classList.add('show');
  }
  function closeModal() { el('authModal').classList.remove('show'); }

  // ---------- 用户态 ----------
  function renderUserbox() {
    const box = el('userbox');
    document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (!user) {
      box.innerHTML = `<button class="alt" onclick="App.openLogin()">登录</button><button class="btn-primary" onclick="App.openRegister()">注册</button>`;
    } else {
      const lvl = user.role === 'learner' ? '' : '';
      box.innerHTML = `<span class="pts">${user.points} 积分</span><span class="muted">${esc(user.username)}·${roleName(user.role)}</span><button class="alt" onclick="App.logout()">退出</button>`;
    }
  }
  function roleName(r){return {learner:'学习用户',capable:'能力用户',admin:'管理员'}[r]||r;}
  function saveSession(t, u) { token = t; user = u; localStorage.setItem(LS_TOKEN, t); localStorage.setItem(LS_USER, JSON.stringify(u)); renderUserbox(); }

  // ---------- 路由 ----------
  function go(v) {
    view = v; renderUserbox();
    const m = el('view');
    if (v === 'home') return renderHome();
    if (v === 'share') return renderShare();
    if (v === 'assess') return renderAssess();
    if (v === 'points') return renderPoints();
  }

  // ---------- 知识广场 ----------
  async function renderHome() {
    let filters = `<div class="card">
      <div class="row">
        <select id="fSubject"><option value="">全部学科</option>${meta.subjects.map(s=>`<option>${s}</option>`).join('')}</select>
        <select id="fGrade"><option value="">全年级</option>${[...Array(12)].map((_,i)=>`<option value="${i+1}">${gradeLabel(i+1)}</option>`).join('')}</select>
        <input id="fQ" placeholder="搜索知识点，如：一元二次方程" style="flex:1;min-width:200px" />
        <button class="act" onclick="App.searchKp()">搜索</button>
        <button class="alt" onclick="App.openGenerate()">➕ 自动生成</button>
      </div></div><div id="kpList"></div>`;
    el('view').innerHTML = `<h2>📚 知识广场</h2>${filters}`;
    await searchKp();
  }
  function srcName(s){ return s==='ai'?'平台生成':(s==='curriculum'?'标准课程库':'用户'); }
  async function searchKp() {
    const s = el('fSubject')?.value || '', g = el('fGrade')?.value || '', q = el('fQ')?.value || '';
    const qs = new URLSearchParams(); if (s) qs.set('subject', s); if (g) qs.set('grade', g); if (q) qs.set('q', q);
    const data = await api('GET', '/knowledge?' + qs.toString()).catch(()=>({items:[]}));
    el('kpList').innerHTML = data.items.length ? data.items.map(k => `
      <div class="kp" onclick="App.openKp(${k.id})">
        <div class="topic">${esc(k.topic)}</div>
        <div class="meta"><span class="tag g">${esc(k.subject)}</span><span class="tag">${esc(k.gradeLabel)}</span>${k.unit?`<span class="tag c">${esc(k.unit)}</span>`:''}<span class="tag">${k.approach_count} 条思路</span><span class="muted">来源：${srcName(k.source)}</span></div>
      </div>`).join('') : `<div class="card muted">暂无知识点，点“自动生成”试试。</div>`;
  }
  function gradeLabel(g){ if(g>=1&&g<=6)return '小学'+'一二三四五六'[g-1]+'年级'; if(g>=7&&g<=9)return '初中'+'一二三'[g-7]+'年级'; if(g>=10&&g<=12)return '高中'+'一二三'[g-10]+'年级'; return g+'年级';}

  function openGenerate() {
    if (!user) return openLogin();
    openModal('自动生成知识点（智能体）', `
      <div class="muted">平台将依据学科 / 年级 / 主题自动生成讲解与典型例题。</div>
      <select id="gSubject">${meta.subjects.map(s=>`<option>${s}</option>`).join('')}</select>
      <select id="gGrade">${[...Array(12)].map((_,i)=>`<option value="${i+1}">${gradeLabel(i+1)}</option>`).join('')}</select>
      <input id="gTopic" placeholder="知识点主题，如：一元二次方程求根公式" />
      <button class="act" onclick="App.doGenerate()">生成</button>`);
  }
  async function doGenerate() {
    const subject = el('gSubject').value, grade = Number(el('gGrade').value), topic = el('gTopic').value.trim();
    if (!topic) return toast('请填写知识点主题');
    try {
      const d = await api('POST', '/knowledge/generate', { subject, grade, topic });
      toast('已生成知识点'); closeModal(); openKp(d.id);
    } catch (e) { toast(e.message); }
  }

  // ---------- 知识点详情 + 自学习匹配 ----------
  async function openKp(id) {
    view = 'home'; renderUserbox();
    let base, match = null;
    try { base = await api('GET', '/knowledge/' + id); } catch(e){ return toast(e.message); }
    currentKp = base.kp;
    if (token) { try { match = await api('POST', '/agent/match', { kpId: id }); } catch(e){} }
    const approaches = (match ? match.approaches : base.approaches) || [];
    const tailored = match ? match.tailored : null;
    const lvlTag = match ? `<span class="tag c">匹配等级：${match.levelLabel}（${match.level}）</span>` : '';
    el('view').innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div><b style="font-size:18px">${esc(base.kp.topic)}</b></div>
          <button class="alt" onclick="App.go('home')">← 返回</button>
        </div>
        <div class="meta" style="margin:6px 0"><span class="tag g">${esc(base.kp.subject)}</span><span class="tag">${esc(base.kp.gradeLabel)}</span>${base.kp.unit?`<span class="tag c">${esc(base.kp.unit)}</span>`:''}${lvlTag}<span class="muted">来源：${srcName(base.kp.source)}</span></div>
        ${base.kp.exam_focus?`<div class="row" style="background:#fff3e0;border:1px solid #ffe0b2;border-radius:10px;padding:10px 12px;margin:8px 0"><b style="color:var(--warn)">🎯 考点：</b><span>${esc(base.kp.exam_focus)}</span></div>`:''}
        <h3>📖 知识点讲解</h3><div style="white-space:pre-wrap">${esc(base.kp.explanation)}</div>
        <h3>📝 典型例题</h3><div style="white-space:pre-wrap">${esc(base.kp.example)}</div>
        ${tailored && tailored!==base.kp.explanation ? `<h3>🤖 为你定制的讲解（自适应）</h3><div style="white-space:pre-wrap;background:#f3fbf7;border:1px solid #cfe9dc;border-radius:10px;padding:12px">${esc(tailored)}</div>`:''}
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">💡 解题思路（类论坛，按匹配度排序）</h2>
          ${user&&user.role==='capable'||user&&user.role==='admin' ? `<button class="alt" onclick="App.go('share')">＋ 我也来分享</button>`:''}
          <button class="alt" onclick="App.autoGrow(${base.kp.id})">🌱 平台自成长</button>
        </div>
        <div id="apList">${renderApproaches(approaches, base.kp.id)}</div>
      </div>`;
  }

  function renderApproaches(list, kpId) {
    if (!list || !list.length) return `<div class="muted">暂无思路，点“我也来分享”成为首位贡献者，或点“平台自成长”让智能体补充。</div>`;
    return list.map(a => {
      const avg = a.rating_count>0 ? (a.rating_sum/a.rating_count).toFixed(1) : '—';
      const stars = a.rating_count>0 ? '★'.repeat(Math.round(a.rating_sum/a.rating_count)) : '';
      const reco = a.recommended ? `<span class="badge">推荐</span>` : '';
      const actions = (user && (user.role==='learner'||user.role==='admin')) ? `
        <div class="row" style="margin-top:8px">
          <button class="sm act" onclick="App.study(${a.id})">学习（−${window.__STUDY__||3}积分）</button>
          <select id="r_${a.id}">
            ${[1,2,3,4,5].map(n=>`<option value="${n}">评分${n}</option>`).join('')}
          </select>
          <label><input type="checkbox" id="ad_${a.id}"/> 采纳</label>
          <button class="sm alt" onclick="App.feedback(${a.id})">提交反馈</button>
        </div>`:'';
      return `<div class="approach ${a.recommended?'reco':''}">
        <div class="title">${esc(a.title)}${reco}</div>
        <div class="meta" style="margin:4px 0"><span class="tag">${esc(a.category||'综合')}</span><span class="muted">作者：${esc(a.author_name)}</span><span class="stars">${stars}</span><span class="muted">${avg}分 · 采纳${a.adopted}</span></div>
        <div style="white-space:pre-wrap">${esc(a.content)}</div>
        ${actions}
      </div>`;
    }).join('');
  }

  async function study(id) {
    if (!user) return openLogin();
    try { const d = await api('POST', '/approaches/'+id+'/study'); toast('已学习，剩余 '+d.points+' 积分'); }
    catch(e){ toast(e.message); }
  }
  async function feedback(id) {
    if (!user) return openLogin();
    const rating = Number(el('r_'+id).value); const adopted = el('ad_'+id).checked?1:0;
    try { await api('POST', '/approaches/'+id+'/feedback', { rating, adopted }); toast('感谢反馈，已记录并奖励作者'); openKp(currentKp.id); }
    catch(e){ toast(e.message); }
  }
  async function autoGrow(id) {
    if (!user) return openLogin();
    try { const d = await api('POST', '/agent/autoGrow', { kpId: id }); toast('智能体已补充一条新思路'); openKp(id); }
    catch(e){ toast(e.message); }
  }

  // ---------- 分享思路 ----------
  async function renderShare() {
    if (!user) { openLogin(); return; }
    if (user.role === 'learner') { el('view').innerHTML = `<div class="card">😅 当前为「学习用户」身份，分享思路需切换为「能力用户」。注册时选择“能力用户”即可分享并赚取积分。</div>`; return; }
    let kps = [];
    try { kps = (await api('GET','/knowledge')).items; } catch(e){}
    el('view').innerHTML = `<h2>💡 分享你的解题思路</h2>
      <div class="card">
        <div class="muted">选择对应的知识点，写下你的理解与解法。被学习用户采纳后，你将赚取积分，平台会分类整理并沉淀为优质内容。</div>
        <select id="sKp"><option value="">— 选择知识点 —</option>${kps.map(k=>`<option value="${k.id}">${esc(k.subject)}·${esc(k.topic)}</option>`).join('')}</select>
        <input id="sTitle" placeholder="思路标题，如：数形结合巧解最值" />
        <input id="sCat" placeholder="方法类别，如：数形结合 / 换元 / 赋值" />
        <textarea id="sContent" placeholder="详细写出解题步骤与易错提醒…"></textarea>
        <button class="act" onclick="App.submitApproach()">发布思路</button>
      </div>`;
  }
  async function submitApproach() {
    const kpId = Number(el('sKp').value), title = el('sTitle').value.trim(), content = el('sContent').value.trim(), category = el('sCat').value.trim();
    if (!kpId || !title || !content) return toast('请选择知识点并填写标题与内容');
    try { const d = await api('POST','/approaches',{ kpId, title, content, category }); toast('发布成功，感谢贡献！'); openKp(kpId); }
    catch(e){ toast(e.message); }
  }

  // ---------- 能力测评 ----------
  async function renderAssess() {
    if (!user) { openLogin(); return; }
    if (user.role !== 'learner') { el('view').innerHTML = `<div class="card">📝 分级测评面向「学习用户」。当前为能力用户/管理员，可切换到学习用户体验测评与自适应匹配。</div>`; return; }
    const grade = user.grade || 7;
    el('view').innerHTML = `<h2>📝 能力测评与自适应匹配</h2>
      <div class="card">
        <div class="row">
          <label>年级</label><select id="aGrade">${[...Array(12)].map((_,i)=>`<option value="${i+1}" ${i+1===grade?'selected':''}>${gradeLabel(i+1)}</option>`).join('')}</select>
          <label>评比标准</label>
          <select id="aCrit">
            <option value="balanced">综合</option>
            <option value="accuracy">准确率优先</option>
            <option value="speed">速度优先</option>
            <option value="breadth">知识广度优先</option>
          </select>
          <button class="act" onclick="App.startAssess()">开始测评</button>
        </div>
        <div id="quiz" style="margin-top:12px"></div>
      </div>`;
  }
  async function startAssess() {
    const grade = Number(el('aGrade').value), crit = el('aCrit').value;
    let data;
    try { data = await api('GET','/assessment/questions?grade='+grade); } catch(e){ return toast(e.message); }
    if (!data.items.length) return toast('该年级暂无题目');
    window.__quiz__ = data.items;
    el('quiz').innerHTML = `<div class="muted">共 ${data.items.length} 题，请选择你认为正确的选项：</div>` + data.items.map((q,i)=>`
      <div class="card">
        <div><b>Q${i+1}.</b> [${esc(q.subject)}] ${esc(q.question)}</div>
        ${q.options.map((o,oi)=>`<div><label><input type="radio" name="q_${q.id}" value="${oi}"/> ${esc(o)}</label></div>`).join('')}
      </div>`).join('') + `<button class="act" onclick="App.submitAssess(${grade},'${crit}')">提交测评</button>`;
  }
  async function submitAssess(grade, crit) {
    const qs = window.__quiz__ || [];
    const answers = {};
    qs.forEach(q => { const sel = document.querySelector(`input[name="q_${q.id}"]:checked`); if (sel) answers[q.id] = Number(sel.value); });
    let res;
    try { res = await api('POST','/assessment/submit',{ grade, answers, criteria: crit }); } catch(e){ return toast(e.message); }
    el('quiz').innerHTML = `<div class="card" style="border-color:var(--primary)">
      <h2 style="margin:0">测评结果</h2>
      <div class="kpi">
        <div class="box">等级<b>${res.levelLabel}<br/><span class="muted">${res.level}</span></b></div>
        <div class="box">得分<b>${res.score}</b></div>
        <div class="box">正确率<b>${res.correct}/${res.total}</b></div>
      </div>
      <div class="muted" style="margin-top:8px">平台已记录你的能力等级，后续“智能匹配”将据此为你推送最合适的解题思路。</div>
      <div class="row" style="margin-top:10px">
        <select id="mKp"><option value="">选择知识点查看匹配思路…</option></select>
        <button class="act" onclick="App.matchFromAssess()">查看匹配思路</button>
      </div>
      <div id="matchOut" style="margin-top:10px"></div>
    </div>`;
    // 填充知识点下拉
    let kps=[]; try{ kps=(await api('GET','/knowledge')).items; }catch(e){}
    el('mKp').innerHTML = `<option value="">选择知识点查看匹配思路…</option>` + kps.map(k=>`<option value="${k.id}">${esc(k.subject)}·${esc(k.topic)}</option>`).join('');
    window.__assessLevel__ = res.level;
  }
  async function matchFromAssess() {
    const kpId = Number(el('mKp').value); if (!kpId) return toast('请选择知识点');
    const lvl = window.__assessLevel__ || 'L3';
    let m; try { m = await api('POST','/agent/match',{ kpId, level: lvl }); } catch(e){ return toast(e.message); }
    el('matchOut').innerHTML = `<div class="muted">依据你的等级 <b>${m.levelLabel}</b>，平台为你排序如下（带“推荐”的为最契合思路）：</div>` + renderApproaches(m.approaches, kpId);
  }

  // ---------- 积分中心 ----------
  async function renderPoints() {
    if (!user) { openLogin(); return; }
    let me, tx=[], lead=[];
    try { me = await api('GET','/points/me'); tx = (await api('GET','/points/transactions')).items; lead=(await api('GET','/stats/leaderboard')).items; } catch(e){ return toast(e.message); }
    const typeName = { earn:'赚取', consume:'消耗', purchase:'购买', exchange_in:'兑换入', exchange_out:'兑换出' };
    el('view').innerHTML = `<h2>🪙 积分中心</h2>
      <div class="kpi">
        <div class="box">我的积分<b>${me.points}</b></div>
        <div class="box">人民币余额<b>¥${me.rmb_balance}</b></div>
      </div>
      <div class="grid2" style="margin-top:14px">
        <div class="card">
          <h3>人民币购买积分</h3>
          <div class="muted">兑换比例：1 元 = ${meta.exchangeRate} 积分</div>
          ${meta.packages.map(p=>`<div class="row" style="justify-content:space-between;border-bottom:1px dashed var(--line);padding:8px 0">
            <span>${esc(p.label)} · ${p.points}积分 · ¥${p.rmb}</span>
            <button class="sm act" onclick="App.purchase('${p.id}')">购买</button></div>`).join('')}
          <h3 style="margin-top:14px">积分 ⇄ 人民币</h3>
          <select id="exDir"><option value="toPoints">人民币 → 积分</option><option value="toRmb">积分 → 人民币（半价折算）</option></select>
          <input id="exAmt" type="number" placeholder="数量（积分或人民币额）" />
          <button class="alt" onclick="App.exchange()">确认兑换</button>
        </div>
        <div class="card">
          <h3>积分流水</h3>
          ${tx.length?tx.map(t=>`<div class="leader"><span>${typeName[t.type]||t.type} · <span class="muted">${esc(t.description||'')}</span></span><b style="color:${t.amount>=0?'var(--primary)':'var(--danger)'}">${t.amount>=0?'+':''}${t.amount}</b></div>`).join(''):'<div class="muted">暂无流水</div>'}
          <h3 style="margin-top:14px">能力用户贡献榜</h3>
          ${lead.length?lead.map((u,i)=>`<div class="leader"><span>${i+1}. ${esc(u.username)} <span class="muted">${roleName(u.role)}</span></span><b>${u.points}</b></div>`).join(''):'<div class="muted">暂无</div>'}
        </div>
      </div>`;
  }
  async function purchase(pid){ try{ const d=await api('POST','/points/purchase',{packageId:pid}); toast('购买成功，积分 '+d.points); renderPoints(); }catch(e){toast(e.message);} }
  async function exchange(){ const direction=el('exDir').value, amount=Number(el('exAmt').value); if(!amount)return toast('请输入数量'); try{ const d=await api('POST','/points/exchange',{direction,amount}); toast('兑换成功'); renderPoints(); }catch(e){toast(e.message);} }

  // ---------- 登录 / 注册 ----------
  function openLogin(){ openModal('登录', `
    <input id="lUser" placeholder="用户名" />
    <input id="lPwd" type="password" placeholder="密码" />
    <button class="act" style="width:100%" onclick="App.doLogin()">登录</button>
    <div class="muted" style="margin-top:8px">演示账号：teacher / teacher123（能力）· student / student123（学习）</div>`);
  }
  async function doLogin(){ try{ const d=await api('POST','/auth/login',{username:el('lUser').value,password:el('lPwd').value}); saveSession(d.token,d.user); closeModal(); toast('欢迎回来'); go(view); }catch(e){toast(e.message);} }
  function openRegister(){ openModal('注册', `
    <input id="rUser" placeholder="用户名" />
    <input id="rPwd" type="password" placeholder="密码" />
    <div class="row">
      <select id="rRole"><option value="learner">学习用户（测评/学思路）</option><option value="capable">能力用户（分享赚积分）</option></select>
      <select id="rGrade"><option value="">年级（学习用户选填）</option>${[...Array(12)].map((_,i)=>`<option value="${i+1}">${gradeLabel(i+1)}</option>`).join('')}</select>
    </div>
    <button class="act" style="width:100%" onclick="App.doRegister()">注册并赠送 ${window.__SIGNUP__||20} 积分</button>`);
  }
  async function doRegister(){ try{ const d=await api('POST','/auth/register',{username:el('rUser').value,password:el('rPwd').value,role:el('rRole').value,grade:el('rGrade').value||null}); saveSession(d.token,d.user); closeModal(); toast('注册成功'); go(view); }catch(e){toast(e.message);} }
  function logout(){ token='';user=null;localStorage.removeItem(LS_TOKEN);localStorage.removeItem(LS_USER);renderUserbox();go('home'); }

  // ---------- 启动 ----------
  async function init() {
    try { const m = await api('GET','/meta'); meta = m; window.__STUDY__ = 3; window.__SIGNUP__ = 20; } catch(e){}
    if (token) { try { const d = await api('GET','/auth/me'); user = d.user; } catch(e){ token='';localStorage.removeItem(LS_TOKEN); } }
    renderUserbox(); go('home');
    const kp = new URLSearchParams(location.search).get('kp');
    if (kp) { try { await openKp(Number(kp)); } catch(e){} }
  }

  return { go, openLogin, openRegister, closeModal: closeModal, closeAuth: closeModal, doLogin, doRegister, logout,
    searchKp, openGenerate, doGenerate, openKp, study, feedback, autoGrow,
    submitApproach, startAssess, submitAssess, matchFromAssess, purchase, exchange,
    renderUserbox, init };
})();
window.addEventListener('DOMContentLoaded', App.init);
