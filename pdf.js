// pdf.js — 排好版简历 PDF 生成
// 方案：Canvas 排版（中文用系统字体）→ 每页导出 JPEG → 手写最小 PDF 编码器（DCTDecode 嵌入）
// 完全无外部依赖，兼容 MV3 CSP。

// ============ 常量 ============
const A4 = { W: 1240, H: 1754 };      // 150 DPI 像素
const PT = { W: 595.28, H: 841.89 };  // PDF 单位（磅）
const M = 96;                          // 页面边距
const CW = A4.W - M * 2;               // 内容区宽度

const C = {
  primary: "#4f46e5",
  dark: "#1f2430",
  gray: "#6b7280",
  line: "#e5e7eb",
  bullet: "#4f46e5"
};

const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';

// ============ 文本工具 ============
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (let raw of String(text || "").split("\n")) {
    raw = raw.replace(/\r/g, "");
    if (!raw.trim()) { lines.push(""); continue; }
    let cur = "";
    for (const ch of raw) {
      if (ctx.measureText(cur + ch).width <= maxWidth) {
        cur += ch;
      } else {
        if (cur) lines.push(cur);
        cur = ch;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function measureLineHeight(fontSize) {
  return Math.round(fontSize * 1.55);
}

// ============ 排版：生成多页 canvas ============
function renderResumePages(resume, contact) {
  const pages = [];
  let page = newPage();
  let ctx = page.getContext("2d");
  let y = M;

  const ensure = (need) => {
    if (y + need > A4.H - M) {
      pages.push(page);
      page = newPage();
      ctx = page.getContext("2d");
      y = M;
    }
  };
  const setFont = (size, weight, color, align) => {
    ctx.fillStyle = color;
    ctx.textAlign = align || "left";
    ctx.font = `${weight || 400} ${size}px ${FONT}`;
    return size;
  };
  const sectionTitle = (title) => {
    ensure(80);
    const sz = setFont(30, 700, C.primary);
    ctx.fillText(title, M, y);
    y += 18;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, y + 2);
    ctx.lineTo(A4.W - M, y + 2);
    ctx.stroke();
    y += 34;
  };
  const paragraph = (text, size, weight, color) => {
    const lh = measureLineHeight(size);
    const lines = wrapText(ctx, text, CW);
    for (const ln of lines) {
      ensure(lh);
      setFont(size, weight, color);
      ctx.fillText(ln, M, y + size);
      y += lh;
    }
  };
  const bullets = (content) => {
    const size = 22;
    const lh = measureLineHeight(size);
    const indent = 34;
    const raw = String(content || "").split("\n").map((s) => s.replace(/^\s*[-*•·]\s*/, "").trim()).filter(Boolean);
    for (const item of raw) {
      const lines = wrapText(ctx, item, CW - indent);
      lines.forEach((ln, i) => {
        ensure(lh);
        if (i === 0) {
          setFont(size, 600, C.bullet);
          ctx.fillText("•", M + 6, y + size);
          setFont(size, 400, C.dark);
          ctx.fillText(ln, M + indent, y + size);
        } else {
          setFont(size, 400, C.dark);
          ctx.fillText(ln, M + indent, y + size);
        }
        y += lh;
      });
      y += 4;
    }
  };
  const entryTitle = (t) => {
    const size = 26;
    ensure(measureLineHeight(size) + 8);
    setFont(size, 700, C.dark);
    const lines = wrapText(ctx, t, CW - 160);
    ctx.fillText(lines[0], M, y + size);
    y += measureLineHeight(size);
  };
  const entryMeta = (t) => {
    const size = 20;
    const lh = measureLineHeight(size);
    ensure(lh);
    setFont(size, 400, C.gray);
    ctx.fillText(t || "", M, y + size);
    y += lh + 4;
  };

  // ---- 头部 ----
  const name = resume.name || "姓名";
  ensure(120);
  setFont(60, 700, C.dark);
  ctx.fillText(name, M, y + 60);
  y += 88;
  if (resume.headline) {
    setFont(26, 400, C.primary);
    const hlines = wrapText(ctx, resume.headline, CW);
    ctx.fillText(hlines[0], M, y + 26);
    y += 44;
  }
  // 联系方式
  const contacts = [contact.phone, contact.email, contact.location, contact.years ? `工作年限：${contact.years}` : ""].filter(Boolean);
  if (contacts.length) {
    setFont(21, 400, C.gray);
    ctx.fillText(contacts.join("   |   "), M, y + 21);
    y += 46;
  }

  // ---- 个人简介 ----
  if (resume.summary) {
    sectionTitle("个人简介");
    paragraph(resume.summary, 23, 400, C.dark);
    y += 14;
  }

  // ---- 工作经历 ----
  if ((resume.experiences || []).length) {
    sectionTitle("工作经历");
    resume.experiences.forEach((e) => {
      const title = [e.company, e.title].filter(Boolean).join(" · ");
      if (title) entryTitle(title);
      if (e.period) entryMeta(e.period);
      if (e.content) bullets(e.content);
      y += 12;
    });
  }

  // ---- 项目经历 ----
  if ((resume.projects || []).length) {
    sectionTitle("项目经历");
    resume.projects.forEach((p) => {
      const title = [p.name, p.role].filter(Boolean).join(" · ");
      if (title) entryTitle(title);
      if (p.period) entryMeta(p.period);
      if (p.content) bullets(p.content);
      y += 12;
    });
  }

  // ---- 专业技能 ----
  if (resume.skills) {
    sectionTitle("专业技能");
    paragraph(resume.skills, 23, 400, C.dark);
    y += 12;
  }

  // ---- 证书 ----
  if (resume.certifications) {
    sectionTitle("证书");
    paragraph(resume.certifications, 23, 400, C.dark);
    y += 12;
  }

  pages.push(page);
  return pages;
}

function newPage() {
  const c = document.createElement("canvas");
  c.width = A4.W;
  c.height = A4.H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, A4.W, A4.H);
  return c;
}

// ============ 手写 PDF 编码器 ============
const te = new TextEncoder();
function b(s) { return te.encode(s); }
function cat(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 从多页 canvas 生成 PDF Blob
function generatePdfBlob(pages) {
  const images = pages.map((c) => {
    const dataUrl = c.toDataURL("image/jpeg", 0.92);
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { bytes: base64ToBytes(b64), width: c.width, height: c.height };
  });

  const n = images.length;
  const totalObjects = 2 + n * 3;
  const header = b("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const body = [];      // 累积所有对象字节
  const offsets = [0];  // offsets[objNum] = 字节偏移（索引 1..N）
  let running = header.length;

  const pushObj = (...parts) => {
    const bytes = cat(...parts);
    offsets.push(running);
    body.push(bytes);
    running += bytes.length;
  };

  // 先算 Kids 数组
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(3 + i * 3);

  // obj 1: Catalog
  pushObj(b(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`));
  // obj 2: Pages
  pushObj(b(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} >>\nendobj\n`));

  // 每页 3 对象
  for (let i = 0; i < n; i++) {
    const pageId = 3 + i * 3;
    const contId = 4 + i * 3;
    const imgId = 5 + i * 3;
    const img = images[i];
    // Page
    pushObj(b(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT.W} ${PT.H}] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contId} 0 R >>\nendobj\n`));
    // Contents
    const stream = b(`q\n${PT.W} 0 0 ${PT.H} 0 0 cm\n/Im${i} Do\nQ\n`);
    pushObj(b(`${contId} 0 obj\n<< /Length ${stream.length} >>\nstream\n`), stream, b(`\nendstream\nendobj\n`));
    // Image
    const head = b(`${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
    pushObj(head, img.bytes, b(`\nendstream\nendobj\n`));
  }

  // xref
  const xrefOffset = running;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjects; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  xref += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const all = cat(header, ...body, b(xref));
  return new Blob([all], { type: "application/pdf" });
}

// ============ 对外接口 ============
function exportResumePdf(resume, contact, filename) {
  const pages = renderResumePages(resume, contact || {});
  const blob = generatePdfBlob(pages);
  downloadBlob(blob, (filename || (resume.name || "简历")) + "_简历.pdf");
  return blob;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
