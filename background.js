// background.js — 服务工作者
// 职责：截图当前标签页、抓取页面文字。AI 调用在 popup 中完成（fetch 直连，带 host_permissions 权限）。

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "capture") {
    // 截取当前窗口可见区域（招聘信息页面）
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true; // 异步返回
  }

  if (msg && msg.type === "extractText") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: "未找到活动标签页" });
        return;
      }
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, func: extractPageText },
        (results) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            const text = results && results[0] && results[0].result
              ? results[0].result
              : "";
            sendResponse({ ok: true, text });
          }
        }
      );
    });
    return true; // 异步返回
  }

  return false;
});

// 在页面上下文里执行：优先抓取招聘正文，退化为整页正文
function extractPageText() {
  const candidates = [
    "article",
    "main",
    "[class*='job-detail']",
    "[class*='job_detail']",
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[class*='description']",
    "[class*='detail-content']",
    "[class*='position']",
    "[id*='job']",
    "[id*='position']"
  ];
  for (const sel of candidates) {
    try {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 100) {
        return el.innerText.trim();
      }
    } catch (e) { /* 忽略无效选择器 */ }
  }
  return document.body ? document.body.innerText.trim() : "";
}
