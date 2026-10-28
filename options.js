// options.js — 设置页逻辑
// 数据存 chrome.storage.local：{ profile: {...}, api: {...} }

const STORAGE_KEY = "resumemate";

// 默认结构
const EMPTY = {
  profile: {
    name: "", targetTitle: "", phone: "", email: "", location: "", years: "", summary: "",
    education: [],   // {school, degree, major, time}
    experiences: [], // {company, title, time, description}
    projects: [],    // {name, role, time, description}
    skills: [],      // string[]
    certifications: [] // string[]
  },
  api: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini", visionModel: "gpt-4o" }
};

// 各列表字段配置
const LIST_CONFIG = {
  education: [
    { key: "school", label: "学校", ph: "XX 大学" },
    { key: "degree", label: "学历", ph: "本科" },
    { key: "major", label: "专业", ph: "工程管理" },
    { key: "time", label: "时间", ph: "2019.09 - 2023.06" }
  ],
  experience: [
    { key: "company", label: "公司", ph: "XX 有限公司" },
    { key: "title", label: "职位", ph: "前端工程师" },
    { key: "time", label: "时间", ph: "2023.07 - 至今" },
    { key: "description", label: "工作内容（越具体越好，AI 会润色）", ph: "负责……", textarea: true }
  ],
  project: [
    { key: "name", label: "项目名", ph: "XX 系统" },
    { key: "role", label: "角色", ph: "核心开发" },
    { key: "time", label: "时间", ph: "2023.01 - 2023.06" },
    { key: "description", label: "项目描述", ph: "项目背景 / 我的贡献 / 成果", textarea: true }
  ]
};

let state = null;

document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  state = deepMerge(JSON.parse(JSON.stringify(EMPTY)), stored[STORAGE_KEY] || {});
  renderAll();

  document.getElementById("saveBtn").addEventListener("click", save);
  document.getElementById("saveBtn2").addEventListener("click", save);
  document.getElementById("testBtn").addEventListener("click", testConnection);

  document.querySelectorAll(".add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const listName = btn.dataset.add;
      state.profile[listName].push(newItem(listName));
      renderList(listName);
    });
  });
});

function newItem(listName) {
  const cfg = LIST_CONFIG[listName];
  const item = {};
  cfg.forEach((f) => { item[f.key] = ""; });
  return item;
}

function deepMerge(base, override) {
  const out = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(override || {})) {
    if (out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) &&
        override[k] && typeof override[k] === "object" && !Array.isArray(override[k])) {
      out[k] = deepMerge(out[k], override[k]);
    } else if (override[k] !== undefined) {
      out[k] = override[k];
    }
  }
  return out;
}

function renderAll() {
  // 简单字段
  const simple = ["name", "targetTitle", "phone", "email", "location", "years", "summary"];
  simple.forEach((k) => { document.getElementById(k).value = state.profile[k] || ""; });

  // API 字段
  document.getElementById("baseUrl").value = state.api.baseUrl || "";
  document.getElementById("apiKey").value = state.api.apiKey || "";
  document.getElementById("model").value = state.api.model || "";
  document.getElementById("visionModel").value = state.api.visionModel || "";

  // 列表
  ["education", "experience", "project"].forEach(renderList);

  // 技能 / 证书（数组 -> 每行一条）
  document.getElementById("skills").value = (state.profile.skills || []).join("\n");
  document.getElementById("certifications").value = (state.profile.certifications || []).join("\n");
}

function renderList(listName) {
  const cfg = LIST_CONFIG[listName];
  const items = state.profile[listName] || [];
  const container = document.getElementById(listName + "List");
  container.innerHTML = "";

  items.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "item";
    div.dataset.index = idx;

    const head = document.createElement("div");
    head.className = "item-head";
    head.innerHTML = `<strong>#${idx + 1}</strong>`;
    const rm = document.createElement("button");
    rm.className = "rm";
    rm.textContent = "删除";
    rm.addEventListener("click", () => {
      state.profile[listName].splice(idx, 1);
      renderList(listName);
    });
    head.appendChild(rm);
    div.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "grid2";
    cfg.forEach((f) => {
      const label = document.createElement("label");
      label.className = "field";
      label.innerHTML = `<span>${f.label}</span>`;
      let input;
      if (f.textarea) {
        input = document.createElement("textarea");
        input.rows = 3;
      } else {
        input = document.createElement("input");
        input.type = "text";
      }
      input.placeholder = f.ph || "";
      input.value = item[f.key] || "";
      input.dataset.key = f.key;
      input.dataset.index = idx;
      input.addEventListener("input", (e) => {
        state.profile[listName][e.target.dataset.index][e.target.dataset.key] = e.target.value;
      });
      label.appendChild(input);
      grid.appendChild(label);
    });
    div.appendChild(grid);
    container.appendChild(div);
  });
}

function collect() {
  // 简单字段
  const simple = ["name", "targetTitle", "phone", "email", "location", "years", "summary"];
  simple.forEach((k) => { state.profile[k] = document.getElementById(k).value.trim(); });

  state.api.baseUrl = document.getElementById("baseUrl").value.trim();
  state.api.apiKey = document.getElementById("apiKey").value.trim();
  state.api.model = document.getElementById("model").value.trim();
  state.api.visionModel = document.getElementById("visionModel").value.trim();

  state.profile.skills = splitLines(document.getElementById("skills").value);
  state.profile.certifications = splitLines(document.getElementById("certifications").value);
}

function splitLines(text) {
  return (text || "").split("\n").map((s) => s.trim()).filter(Boolean);
}

function save() {
  collect();
  chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
    flash("已保存 ✓");
  });
}

function flash(msg, isErr) {
  const el = document.getElementById("saveMsg");
  el.textContent = msg;
  el.style.color = isErr ? "var(--err)" : "var(--ok)";
  setTimeout(() => { el.textContent = ""; }, 2500);
}

async function testConnection() {
  collect();
  const result = document.getElementById("testResult");
  result.className = "test-result";
  result.textContent = "连接中…";

  const { baseUrl, apiKey, model } = state.api;
  if (!apiKey) { result.className = "test-result err"; result.textContent = "请先填写 API Key"; return; }

  try {
    const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "只回复两个字：正常" }],
        max_tokens: 10
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${errText.slice(0, 200)}`);
    }
    result.className = "test-result ok";
    result.textContent = "✓ 连接成功";
  } catch (e) {
    result.className = "test-result err";
    result.textContent = "✗ " + e.message;
  }
}
