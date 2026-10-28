// popup.js — 主面板逻辑
// Tab1 岗位：抓取/解析 → 生成简历
// Tab2 简历：导入旧简历分析 + 逐段润色 + 导出 PDF/Markdown
// Tab3 对话：AI 按指令修改简历

const STORAGE_KEY = "resumemate";

// ------- 状态 -------
let profile = null;    // 用户资料
let api = null;        // API 配置
let jobInfo = null;    // 岗位信息
let resume = null;     // 生成的简历
let chatHistory = [];  // 对话历史 [{role, content}]

// ------- 初始化 -------
document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const data = stored[STORAGE_KEY] || {};
  profile = data.profile || {};
  api = data.api || {};

  updateStatusDot();
  bindEvents();
  renderChat();
});

function bindEvents() {
  // tab 切换
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });

  // 岗位
  document.getElementById("extractBtn").addEventListener("click", onExtract);
  document.getElementById("captureBtn").addEventListener("click", onCapture);
  document.getElementById("generateBtn").addEventListener("click", onGenerate);

  // 简历
  document.getElementById("importToggle").addEventListener("click", () => {
    const area = document.getElementById("importArea");
    area.hidden = !area.hidden;
  });
  document.getElementById("importFileBtn").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", onImportFile);
  document.getElementById("importAnalyze").addEventListener("click", onImportAnalyze);
  document.getElementById("pdfBtn").addEventListener("click", onExportPdf);
  document.getElementById("copyBtn").addEventListener("click", onCopy);
  document.getElementById("downloadBtn").addEventListener("click", onDownload);

  // 对话
  document.getElementById("chatSend").addEventListener("click", onChatSend);
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onChatSend();
  });

  document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  ["job", "resume", "chat"].forEach((n) => {
    document.getElementById("pane-" + n).hidden = (n !== name);
  });
}

function updateStatusDot() {
  const dot = document.getElementById("statusDot");
  const hasKey = !!(api && api.apiKey);
  dot.className = "dot " + (hasKey ? "ok" : "err");
  dot.title = hasKey ? "API 已配置" : "未配置 API Key，请先点击设置";
}

function setStatus(el, msg, type) {
  const node = document.getElementById(el);
  node.textContent = msg;
  node.className = "status" + (type ? " " + type : "");
}

// ================= 岗位抓取 =================
async function onExtract() {
  setStatus("step1Status", "正在读取页面文字…");
  disable("extractBtn", "captureBtn");
  try {
    const res = await sendMsg({ type: "extractText" });
    if (!res.ok) throw new Error(res.error || "读取失败");
    if (!res.text || res.text.trim().length < 30) throw new Error("页面文字过少，请确认已打开招聘详情页");
    await aiParseJob(res.text.trim().slice(0, 8000));
  } catch (e) {
    setStatus("step1Status", "✗ " + e.message, "err");
  } finally {
    enable("extractBtn", "captureBtn");
  }
}

async function onCapture() {
  setStatus("step1Status", "正在截屏…");
  disable("extractBtn", "captureBtn");
  try {
    const res = await sendMsg({ type: "capture" });
    if (!res.ok) throw new Error(res.error || "截屏失败");
    await aiParseJobFromImage(res.dataUrl);
  } catch (e) {
    setStatus("step1Status", "✗ " + e.message, "err");
  } finally {
    enable("extractBtn", "captureBtn");
  }
}

async function aiParseJob(text) {
  const sys = "你是资深招聘与简历专家。从招聘信息中提取结构化岗位信息，严格只输出 JSON。字段：company(公司), title(岗位), location(地点), salary(薪资), responsibilities(岗位职责,字符串数组), requirements(任职要求,字符串数组), keywords(关键词/加分项,字符串数组)。无法识别填空字符串。";
  setStatus("step1Status", "AI 解析岗位中…");
  const content = await chat([
    { role: "system", content: sys },
    { role: "user", content: "招聘信息：\n\n" + text }
  ], api.model);
  const parsed = extractJson(content);
  if (!parsed) throw new Error("AI 返回无法解析，请重试");
  jobInfo = parsed;
  fillJobForm();
  document.getElementById("jobPanel").hidden = false;
  setStatus("step1Status", "✓ 解析完成，请核对下方信息", "ok");
}

async function aiParseJobFromImage(dataUrl) {
  const sys = "你是资深招聘与简历专家。从招聘信息截图中提取结构化岗位信息，严格只输出 JSON。字段：company, title, location, salary, responsibilities(字符串数组), requirements(字符串数组), keywords(字符串数组)。无法识别填空字符串。";
  setStatus("step1Status", "AI 识别截图中…（视觉模型较慢）");
  const content = await chat([
    { role: "system", content: sys },
    { role: "user", content: [
      { type: "text", text: "识别这张招聘信息截图，输出结构化 JSON。" },
      { type: "image_url", image_url: { url: dataUrl } }
    ] }
  ], api.visionModel || api.model);
  const parsed = extractJson(content);
  if (!parsed) throw new Error("AI 返回无法解析，请改用「读取页面文字」");
  jobInfo = parsed;
  fillJobForm();
  document.getElementById("jobPanel").hidden = false;
  setStatus("step1Status", "✓ 识别完成，请核对下方信息", "ok");
}

function fillJobForm() {
  document.getElementById("jobCompany").value = jobInfo.company || "";
  document.getElementById("jobTitle").value = jobInfo.title || "";
  document.getElementById("jobLocation").value = jobInfo.location || "";
  document.getElementById("jobSalary").value = jobInfo.salary || "";
  document.getElementById("jobRespons").value = arr(jobInfo.responsibilities).join("\n");
  document.getElementById("jobReqs").value = arr(jobInfo.requirements).join("\n");
  document.getElementById("jobKeywords").value = arr(jobInfo.keywords).join("\n");
}

function collectJobForm() {
  jobInfo = {
    company: document.getElementById("jobCompany").value.trim(),
    title: document.getElementById("jobTitle").value.trim(),
    location: document.getElementById("jobLocation").value.trim(),
    salary: document.getElementById("jobSalary").value.trim(),
    responsibilities: splitLines(document.getElementById("jobRespons").value),
    requirements: splitLines(document.getElementById("jobReqs").value),
    keywords: splitLines(document.getElementById("jobKeywords").value)
  };
}

// ================= 生成简历 =================
async function onGenerate() {
  if (!profile || !profile.name) {
    const ok = confirm("还没有填写个人信息（或导入旧简历），现在去设置页填写吗？");
    if (ok) chrome.runtime.openOptionsPage();
    return;
  }
  collectJobForm();
  setStatus("step2Status", "正在生成定制简历…");
  disable("generateBtn");
  try {
    const sys = "你是顶级简历专家。根据用户个人资料与目标岗位生成定制简历：1)突出匹配经历和关键词；2)经历用 STAR 法则、量化成果；3)真实、不编造。严格只输出 JSON：{\"name\":姓名,\"headline\":一句话定位,\"summary\":个人简介,\"experiences\":[{\"company\":\"\",\"title\":\"\",\"period\":\"\",\"content\":\"分点描述，每点一行\"}],\"projects\":[{\"name\":\"\",\"role\":\"\",\"period\":\"\",\"content\":\"分点描述\"}],\"skills\":\"技能(逗号分隔)\",\"certifications\":\"证书(逗号分隔)\"}";
    const content = await chat([
      { role: "system", content: sys },
      { role: "user", content: "目标岗位：\n" + JSON.stringify(jobInfo, null, 2) + "\n\n个人资料：\n" + JSON.stringify(profile, null, 2) }
    ], api.model, { temperature: 0.6 });
    const parsed = extractJson(content);
    if (!parsed) throw new Error("生成失败，请重试");
    resume = normalizeResume(parsed);
    renderResume();
    document.getElementById("resumePanel").hidden = false;
    setStatus("step2Status", "✓ 已生成，可润色或导出 PDF", "ok");
  } catch (e) {
    setStatus("step2Status", "✗ " + e.message, "err");
  } finally {
    enable("generateBtn");
  }
}

function normalizeResume(r) {
  return {
    name: r.name || (profile && profile.name) || "",
    headline: r.headline || "",
    summary: r.summary || "",
    experiences: arr(r.experiences),
    projects: arr(r.projects),
    skills: r.skills || "",
    certifications: r.certifications || ""
  };
}

// ================= 渲染简历 =================
function renderResume() {
  const list = document.getElementById("resumeList");
  list.innerHTML = "";
  if (!resume) return;

  const head = document.createElement("div");
  head.className = "card-item";
  head.innerHTML = `<div class="c-title" style="font-size:16px">${esc(resume.name || "")}</div>` +
    `<div class="c-meta">${esc(resume.headline || "")}</div>`;
  list.appendChild(head);

  list.appendChild(buildCard("个人简介", resume.summary || "", "summary", null, null));

  (resume.experiences || []).forEach((exp, i) => {
    const title = `${exp.company || ""} · ${exp.title || ""}`;
    list.appendChild(buildCard(title, exp.content || "", "experience", exp.period || "", i));
  });

  (resume.projects || []).forEach((p, i) => {
    const title = `${p.name || ""}${p.role ? " · " + p.role : ""}`;
    list.appendChild(buildCard(title, p.content || "", "project", p.period || "", i));
  });

  list.appendChild(buildCard("专业技能", resume.skills || "", "skills", null, null));
  list.appendChild(buildCard("证书", resume.certifications || "", "certifications", null, null));
}

function buildCard(title, content, type, meta, index) {
  const div = document.createElement("div");
  div.className = "card-item";

  const head = document.createElement("div");
  head.className = "c-head";
  const t = document.createElement("div");
  t.className = "c-title";
  t.textContent = title;
  head.appendChild(t);

  const polishBtn = document.createElement("button");
  polishBtn.className = "polish";
  polishBtn.textContent = "✨ 润色";
  polishBtn.dataset.type = type;
  polishBtn.dataset.index = index ?? "";
  polishBtn.addEventListener("click", onPolish);
  head.appendChild(polishBtn);
  div.appendChild(head);

  if (meta) {
    const m = document.createElement("div");
    m.className = "c-meta";
    m.textContent = meta;
    div.appendChild(m);
  }

  const ta = document.createElement("textarea");
  ta.value = content;
  ta.dataset.type = type;
  ta.dataset.index = index ?? "";
  ta.rows = type === "skills" || type === "certifications" ? 2 : 6;
  ta.addEventListener("input", (e) => applyEdit(e.target.dataset.type, e.target.dataset.index, e.target.value));
  div.appendChild(ta);

  return div;
}

function applyEdit(type, index, value) {
  if (!resume) return;
  if (type === "summary") { resume.summary = value; return; }
  if (type === "skills") { resume.skills = value; return; }
  if (type === "certifications") { resume.certifications = value; return; }
  const arrName = type === "experience" ? "experiences" : "projects";
  const item = resume[arrName][index];
  if (item) item.content = value;
}

async function onPolish(e) {
  const btn = e.target;
  const type = btn.dataset.type;
  const index = btn.dataset.index === "" ? null : parseInt(btn.dataset.index, 10);
  const originalText = getCurrentContent(type, index);
  if (!originalText.trim()) return;

  btn.disabled = true;
  btn.textContent = "润色中…";
  setStatus("step3Status", "正在润色…");
  try {
    const sys = "你是简历润色专家。润色下面这段简历内容使其更匹配岗位：STAR 法则、量化成果、用岗位关键词、措辞专业。保持真实不编造。直接输出润色后的内容（不要 JSON、不要解释）。";
    const content = await chat([
      { role: "system", content: sys },
      { role: "user", content: "目标岗位：\n" + JSON.stringify(jobInfo, null, 2) + "\n\n待润色内容：\n" + originalText }
    ], api.model, { temperature: 0.5 });
    const polished = content.trim();
    if (!polished) throw new Error("润色结果为空");
    applyEdit(type, index, polished);
    renderResume();
    setStatus("step3Status", "✓ 润色完成", "ok");
  } catch (err) {
    setStatus("step3Status", "✗ " + err.message, "err");
    btn.disabled = false;
    btn.textContent = "✨ 润色";
  }
}

function getCurrentContent(type, index) {
  if (type === "summary") return resume.summary || "";
  if (type === "skills") return resume.skills || "";
  if (type === "certifications") return resume.certifications || "";
  const arrName = type === "experience" ? "experiences" : "projects";
  const item = resume[arrName][index];
  return item ? item.content || "" : "";
}

// ================= 导出 =================
function onExportPdf() {
  if (!resume) { setStatus("step3Status", "请先生成简历", "err"); return; }
  const contact = {
    phone: profile && profile.phone,
    email: profile && profile.email,
    location: profile && profile.location,
    years: profile && profile.years
  };
  try {
    exportResumePdf(resume, contact);
    setStatus("step3Status", "✓ PDF 已下载", "ok");
  } catch (e) {
    setStatus("step3Status", "✗ 导出失败：" + e.message, "err");
  }
}

function buildMarkdown() {
  if (!resume) return "";
  const L = [];
  L.push("# " + (resume.name || ""));
  if (resume.headline) L.push("> " + resume.headline);
  L.push("");
  if (resume.summary) { L.push("## 个人简介"); L.push(""); L.push(resume.summary); L.push(""); }
  if ((resume.experiences || []).length) {
    L.push("## 工作经历"); L.push("");
    resume.experiences.forEach((e) => {
      L.push("### " + [e.company, e.title].filter(Boolean).join(" · "));
      if (e.period) L.push("_ " + e.period + " _");
      L.push(e.content || ""); L.push("");
    });
  }
  if ((resume.projects || []).length) {
    L.push("## 项目经历"); L.push("");
    resume.projects.forEach((p) => {
      L.push("### " + [p.name, p.role].filter(Boolean).join(" · "));
      if (p.period) L.push("_ " + p.period + " _");
      L.push(p.content || ""); L.push("");
    });
  }
  if (resume.skills) { L.push("## 专业技能"); L.push(""); L.push(resume.skills); L.push(""); }
  if (resume.certifications) { L.push("## 证书"); L.push(""); L.push(resume.certifications); L.push(""); }
  return L.join("\n").trim();
}

function onCopy() {
  if (!resume) return;
  navigator.clipboard.writeText(buildMarkdown()).then(() => {
    setStatus("step3Status", "✓ 已复制", "ok");
  }).catch(() => setStatus("step3Status", "复制失败", "err"));
}

function onDownload() {
  if (!resume) return;
  const blob = new Blob([buildMarkdown()], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, (resume.name || "简历") + "_简历.md");
  setStatus("step3Status", "✓ 已下载", "ok");
}

// ================= 导入旧简历 =================
let importedFile = null; // {type: 'text'|'image', content}

function onImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  if (file.type.startsWith("image/")) {
    reader.onload = () => {
      importedFile = { type: "image", content: reader.result };
      setStatus("importResult", "✓ 已读取图片：" + file.name, "ok");
    };
    reader.readAsDataURL(file);
  } else {
    reader.onload = () => {
      importedFile = { type: "text", content: String(reader.result || "") };
      setStatus("importResult", "✓ 已读取文件：" + file.name, "ok");
    };
    reader.readAsText(file);
  }
}

async function onImportAnalyze() {
  const text = document.getElementById("importText").value.trim();
  if (!text && !importedFile) {
    setStatus("importResult", "请粘贴文本或选择文件", "err");
    return;
  }
  setStatus("importResult", "AI 分析简历中…");
  disable("importAnalyze", "importFileBtn");
  try {
    let parsed;
    if (importedFile && importedFile.type === "image") {
      parsed = await aiParseResumeImage(importedFile.content);
    } else {
      const source = importedFile && importedFile.type === "text" ? importedFile.content : text;
      parsed = await aiParseResumeText(source);
    }
    if (!parsed || !parsed.profile) throw new Error("分析失败，请重试");
    mergeProfile(parsed.profile);
    await chrome.storage.local.set({ [STORAGE_KEY]: { profile, api } });
    setStatus("importResult", "✓ 已导入个人资料，可去「岗位」页生成简历", "ok");
    if (parsed.suggestions && parsed.suggestions.length) {
      appendImportSuggestions(parsed.suggestions);
    }
  } catch (e) {
    setStatus("importResult", "✗ " + e.message, "err");
  } finally {
    enable("importAnalyze", "importFileBtn");
  }
}

async function aiParseResumeText(text) {
  const sys = resumeImportPrompt();
  const content = await chat([
    { role: "system", content: sys },
    { role: "user", content: "我的简历：\n\n" + String(text).slice(0, 12000) }
  ], api.model);
  return extractJson(content);
}

async function aiParseResumeImage(dataUrl) {
  const sys = resumeImportPrompt();
  const content = await chat([
    { role: "system", content: sys },
    { role: "user", content: [
      { type: "text", text: "这是我的简历截图/图片，请提取结构化信息。" },
      { type: "image_url", image_url: { url: dataUrl } }
    ] }
  ], api.visionModel || api.model);
  return extractJson(content);
}

function resumeImportPrompt() {
  return "你是简历解析专家。从用户提供的简历中提取结构化信息，并给出改进建议。严格只输出 JSON：{\"profile\":{\"name\":姓名,\"targetTitle\":求职意向,\"phone\":电话,\"email\":邮箱,\"location\":城市,\"years\":工作年限,\"summary\":个人简介,\"education\":[{\"school\":\"\",\"degree\":\"\",\"major\":\"\",\"time\":\"\"}],\"experiences\":[{\"company\":\"\",\"title\":\"\",\"time\":\"\",\"description\":\"\"}],\"projects\":[{\"name\":\"\",\"role\":\"\",\"time\":\"\",\"description\":\"\"}],\"skills\":[\"技能1\",\"技能2\"],\"certifications\":[\"证书1\"]},\"suggestions\":[\"改进建议1\",\"建议2\"]}。缺失字段填空字符串或空数组，不要编造。";
}

function mergeProfile(p) {
  if (!profile) profile = {};
  const keys = ["name", "targetTitle", "phone", "email", "location", "years", "summary"];
  keys.forEach((k) => { if (p[k]) profile[k] = p[k]; });
  ["education", "experiences", "projects"].forEach((k) => {
    if (Array.isArray(p[k]) && p[k].length) profile[k] = p[k];
  });
  if (Array.isArray(p.skills) && p.skills.length) profile.skills = p.skills;
  if (Array.isArray(p.certifications) && p.certifications.length) profile.certifications = p.certifications;
}

function appendImportSuggestions(suggestions) {
  const el = document.getElementById("importResult");
  const div = document.createElement("div");
  div.className = "status";
  div.innerHTML = "<b>💡 分析建议：</b><br>" + suggestions.map((s) => "• " + esc(s)).join("<br>");
  el.parentNode.appendChild(div);
}

// ================= 对话窗口 =================
async function onChatSend() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;
  if (!resume) {
    addChatMsg("sys", "请先在「岗位」页生成简历，或「简历」页导入旧简历。");
    input.value = "";
    return;
  }
  input.value = "";
  addChatMsg("user", text);
  const sendBtn = document.getElementById("chatSend");
  sendBtn.disabled = true;
  addChatMsg("ai", "思考中…");
  try {
    const sys = "你是简历修改助手。用户会给你修改指令，你基于当前简历直接修改，并返回严格 JSON：{\"reply\":\"给用户的简短中文说明(1-2句)\",\"resume\":{完整修改后的简历对象}}。resume 结构：{\"name\":\"\",\"headline\":\"\",\"summary\":\"\",\"experiences\":[{\"company\":\"\",\"title\":\"\",\"period\":\"\",\"content\":\"\"}],\"projects\":[{\"name\":\"\",\"role\":\"\",\"period\":\"\",\"content\":\"\"}],\"skills\":\"\",\"certifications\":\"\"}。保持真实，不编造经历。";
    const context = "目标岗位：\n" + JSON.stringify(jobInfo || {}, null, 2) +
      "\n\n当前简历：\n" + JSON.stringify(resume, null, 2) +
      "\n\n用户指令：" + text;

    const history = chatHistory.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    const content = await chat([
      { role: "system", content: sys },
      ...history,
      { role: "user", content: context }
    ], api.model, { temperature: 0.5 });

    const parsed = extractJson(content);
    const lastAi = document.querySelector(".msg.ai:last-child");
    if (parsed && parsed.resume) {
      resume = normalizeResume(parsed.resume);
      renderResume();
      if (lastAi) lastAi.textContent = (parsed.reply || "已修改") + "\n\n✅ 简历已更新，请在「简历」页查看/导出";
      chatHistory.push({ role: "user", content: text });
      chatHistory.push({ role: "assistant", content: content.trim() });
    } else if (parsed && parsed.reply) {
      if (lastAi) lastAi.textContent = parsed.reply;
    } else {
      if (lastAi) lastAi.textContent = content.trim();
    }
  } catch (e) {
    const lastAi = document.querySelector(".msg.ai:last-child");
    if (lastAi) lastAi.textContent = "✗ " + e.message;
  } finally {
    sendBtn.disabled = false;
  }
}

function addChatMsg(role, text) {
  const log = document.getElementById("chatLog");
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function renderChat() {
  const log = document.getElementById("chatLog");
  log.innerHTML = "";
  addChatMsg("sys", "我可以帮你修改简历。例如：\n• 把工作经历写得更量化\n• 突出与岗位相关的项目\n• 精简个人简介\n• 技能里加上 XX");
}

// ================= 工具函数 =================
function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res);
    });
  });
}

async function chat(messages, model, opts = {}) {
  if (!api || !api.apiKey) {
    throw new Error("未配置 API Key，请点击右上角 ⚙️ 设置");
  }
  const url = (api.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "") + "/chat/completions";
  const body = { model: model || api.model, messages, temperature: opts.temperature ?? 0.3 };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + api.apiKey },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`API 错误 HTTP ${res.status}: ${errText.slice(0, 160)}`);
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : "";
  if (!content) throw new Error("API 返回为空");
  return content;
}

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* fallthrough */ }
  }
  try { return JSON.parse(t); } catch (e) { return null; }
}

function arr(v) { return Array.isArray(v) ? v : []; }
function splitLines(s) { return (s || "").split("\n").map((x) => x.trim()).filter(Boolean); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function disable(...ids) { ids.forEach((id) => { document.getElementById(id).disabled = true; }); }
function enable(...ids) { ids.forEach((id) => { document.getElementById(id).disabled = false; }); }
