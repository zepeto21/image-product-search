// 백그라운드: 검색 작업 관리 (탭 열기, 이미지 전달, 결과 수집)
const START_URL = {
  '1688': 'https://www.1688.com/',
  taobao: 'https://s.taobao.com/search?tab=all',
  ali: 'https://ko.aliexpress.com/',
};
const TASK_TTL = 3 * 60 * 1000; // 3분 지난 작업은 무시
const HISTORY_MAX = 20;

// 저장소 쓰기가 겹치지 않도록 순서대로 처리
let lock = Promise.resolve();
function withLock(fn) {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
}

async function getJob() {
  return (await chrome.storage.local.get('job')).job || null;
}
async function setJob(job) {
  await chrome.storage.local.set({ job });
}
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { closeTabs: true, foreground: false, ...(settings || {}) };
}

async function openApp() {
  const url = chrome.runtime.getURL('app.html');
  const [t] = await chrome.tabs.query({ url });
  if (t) {
    await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    return t;
  }
  return chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => openApp());

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'isearch',
      title: '1688·타오바오·알리에서 이 이미지 찾기',
      contexts: ['image'],
    });
  });
});

function bufToBase64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function urlToDataUrl(url) {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url);
  if (!res.ok) throw new Error('이미지를 가져오지 못했어요 (' + res.status + ')');
  const type = res.headers.get('content-type') || 'image/jpeg';
  return `data:${type};base64,${bufToBase64(await res.arrayBuffer())}`;
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'isearch' || !info.srcUrl) return;
  let pending;
  try {
    pending = { dataUrl: await urlToDataUrl(info.srcUrl), ts: Date.now() };
  } catch (e) {
    pending = { error: String(e.message || e), ts: Date.now() };
  }
  await chrome.storage.local.set({ pendingImage: pending });
  await openApp();
});

async function closeJobTabs(job) {
  if (!job?.tabs) return;
  for (const [tabId, src] of Object.entries(job.tabs)) {
    if (job.status?.[src] !== 'done') {
      try { await chrome.tabs.remove(Number(tabId)); } catch (e) {}
    }
  }
}

async function startSearch({ dataUrl, thumb, sources }) {
  const settings = await getSettings();
  const old = await getJob();
  await closeJobTabs(old);

  const job = {
    id: Date.now().toString(36),
    ts: Date.now(),
    dataUrl,
    thumb,
    sources,
    tabs: {},
    status: {},
    results: {},
    errors: {},
    urls: {},
  };
  for (const src of sources) job.status[src] = 'pending';
  await setJob(job);

  for (const src of sources) {
    const tab = await chrome.tabs.create({ url: START_URL[src], active: !!settings.foreground && src === sources[0] });
    await withLock(async () => {
      const j = await getJob();
      if (!j || j.id !== job.id) return;
      j.tabs[tab.id] = src;
      await setJob(j);
    });
  }
  return { ok: true, id: job.id };
}

async function saveHistory(job) {
  const { history = [] } = await chrome.storage.local.get('history');
  const entry = {
    id: job.id,
    ts: job.ts,
    thumb: job.thumb,
    results: job.results,
    urls: job.urls,
  };
  const next = [entry, ...history.filter((h) => h.id !== job.id)].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ history: next });
}

function tabSource(job, sender) {
  const id = sender?.tab?.id;
  if (!job || id == null) return null;
  return job.tabs[id] || null;
}

async function waitForTab(job, sender, ms = 3000) {
  // 탭 생성 직후에는 tabId 기록 전에 메시지가 올 수 있어서 잠깐 기다린다
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const j = await getJob();
    if (tabSource(j, sender)) return j;
    await new Promise((r) => setTimeout(r, 200));
  }
  return await getJob();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'startSearch':
        return startSearch(msg);

      case 'getTask': {
        await waitForTab(await getJob(), sender);
        return withLock(async () => {
          const job = await getJob();
          const src = tabSource(job, sender);
          if (!src || src !== msg.source) return null;
          if (Date.now() - job.ts > TASK_TTL) return null;
          if (job.status[src] !== 'pending') return null;
          job.status[src] = 'uploading';
          await setJob(job);
          return { dataUrl: job.dataUrl, id: job.id };
        });
      }

      case 'isJobTab': {
        const job = await getJob();
        const src = tabSource(job, sender);
        return !!src && src === msg.source && job.status[src] !== 'done' && Date.now() - job.ts < TASK_TTL;
      }

      case 'progress':
        return withLock(async () => {
          const job = await getJob();
          const src = tabSource(job, sender);
          if (!src || job.status[src] === 'done') return false;
          job.status[src] = msg.status;
          await setJob(job);
          return true;
        });

      case 'taskError':
        return withLock(async () => {
          const job = await getJob();
          const src = tabSource(job, sender);
          if (!src || job.status[src] === 'done') return false;
          job.status[src] = 'error';
          job.errors[src] = msg.error;
          await setJob(job);
          const allDone = job.sources.every((s) => ['done', 'error'].includes(job.status[s]));
          if (allDone) await saveHistory(job);
          return true;
        });

      case 'results': {
        const settings = await getSettings();
        const done = await withLock(async () => {
          const job = await getJob();
          const src = tabSource(job, sender);
          if (!src || job.status[src] === 'done') return null;
          job.status[src] = 'done';
          job.results[src] = msg.items || [];
          job.urls[src] = msg.url;
          if (msg.note && !(msg.items || []).length) job.errors[src] = msg.note;
          await setJob(job);
          const allDone = job.sources.every((s) => ['done', 'error'].includes(job.status[s]));
          if (allDone) await saveHistory(job);
          return job;
        });
        if (done && settings.closeTabs && (msg.items || []).length) {
          try { await chrome.tabs.remove(sender.tab.id); } catch (e) {}
        }
        return !!done;
      }

      case 'focusSource': {
        const job = await getJob();
        const entry = Object.entries(job?.tabs || {}).find(([, s]) => s === msg.source);
        if (entry) {
          try {
            const t = await chrome.tabs.update(Number(entry[0]), { active: true });
            await chrome.windows.update(t.windowId, { focused: true });
            return true;
          } catch (e) {}
        }
        if (job?.urls?.[msg.source]) {
          await chrome.tabs.create({ url: job.urls[msg.source] });
          return true;
        }
        return false;
      }

      case 'fetchImage':
        try {
          return { dataUrl: await urlToDataUrl(msg.url) };
        } catch (e) {
          return { error: String(e.message || e) };
        }

      default:
        return null;
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});

// 검색 탭을 사용자가 닫으면 오류로 표시
chrome.tabs.onRemoved.addListener((tabId) => {
  withLock(async () => {
    const job = await getJob();
    const src = job?.tabs?.[tabId];
    if (!src) return;
    if (!['done', 'error'].includes(job.status[src])) {
      job.status[src] = 'error';
      job.errors[src] = '검색 탭이 닫혔어요';
      const allDone = job.sources.every((s) => ['done', 'error'].includes(job.status[s]));
      await setJob(job);
      if (allDone) await saveHistory(job);
    }
  });
});
