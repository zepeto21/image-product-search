// 소싱 이미지검색 화면
const $ = (s) => document.querySelector(s);
const SRC_NAME = { '1688': '1688', taobao: '타오바오', ali: '알리익스프레스' };
const SRC_ORDER = ['1688', 'taobao', 'ali'];
const DEFAULTS = {
  liveRate: 199,
  liveRateTs: 0,
  liveRateManual: false,
  usdRate: 1400,
  calcRate: 200,
  localShip: 3,
  shipBurden: 3000,
  feePct: 6,
  marginPct: 30,
  roundTo: 100,
  aliShip: 0,
  closeTabs: true,
  foreground: false,
  src1688: true,
  srcTaobao: true,
  srcAli: true,
  view: 'side',
  sort: 'rank',
};

const state = {
  settings: { ...DEFAULTS },
  job: null,
  viewing: null, // null = 현재 검색, 아니면 history entry
  history: [],
  lastImage: null, // {dataUrl, thumb}
  translate: false,
  translator: null,
  tr: new Map(),
  timer: null,
};

// ---------- 도우미 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (n == null || isNaN(n) ? '-' : Math.round(n).toLocaleString('ko-KR') + '원');
const send = (msg) => chrome.runtime.sendMessage(msg);

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function salesNum(s) {
  if (!s) return 0;
  const m = String(s).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(万|만|K|k|천)?/);
  if (!m) return 0;
  const mul = { '万': 10000, '만': 10000, K: 1000, k: 1000, '천': 1000 }[m[2]] || 1;
  return parseFloat(m[1]) * mul;
}

const KO = [
  [/(\d+(?:\.\d+)?)万\+?件/g, '판매 $1만+개'],
  [/(\d+)\+件(?!起)/g, '판매 $1+개'],
  [/(\d+(?:\.\d+)?)万\+?人付款/g, '$1만+명 구매'],
  [/(\d+)\+?人付款/g, '$1명 구매'],
  [/(\d+)件起批/g, '$1개부터 주문'],
  [/(\d+)件起订/g, '$1개부터 주문'],
  [/包邮/g, '중국내 무료배송'],
  [/先采后付/g, '선구매 후결제'],
  [/7天无理由/g, '7일 무조건 반품'],
  [/回头率/g, '재구매율 '],
  [/(\d+)天达/g, '$1일 도착'],
  [/后天达/g, '모레 도착'],
  [/明天达/g, '내일 도착'],
  [/(\d+)小时发货/g, '$1시간 내 발송'],
  [/当日发货|今日发货/g, '당일 발송'],
  [/7\*24小时响应/g, '24시간 응대'],
  [/分销代发|一件代发/g, '1개 드롭쉬핑'],
];
function ko(s) {
  let out = String(s || '');
  for (const [re, to] of KO) out = out.replace(re, to);
  return out;
}

// ---------- 가격 계산 ----------
// 사이트 설정에 따라 가격이 위안/달러/원화 등으로 나오므로 통화를 가격 표시에서 읽는다.
function detectCur(t) {
  t = String(t || '');
  if (/JP¥|円/.test(t)) return 'JPY';
  if (/HK\$/.test(t)) return 'HKD';
  if (/NT\$/.test(t)) return 'TWD';
  if (/US\$|USD|\$/.test(t)) return 'USD';
  if (/₩|원|KRW/.test(t)) return 'KRW';
  if (/€|EUR/.test(t)) return 'EUR';
  if (/£|GBP/.test(t)) return 'GBP';
  if (/¥|￥|元|CNY|RMB/.test(t)) return 'CNY';
  return null;
}
const curOf = (it) => it.currency || detectCur(it.priceText) || (it.source === 'ali' ? 'KRW' : 'CNY');
const isKrw = (it) => curOf(it) === 'KRW';
const isDirect = (it) => it.source === 'ali'; // 알리 = 한국 직배송
const CUR_SYM = { CNY: '¥', USD: '$', KRW: '₩', EUR: '€', GBP: '£', JPY: 'JP¥', HKD: 'HK$', TWD: 'NT$' };
// 1단위 = 몇 원인지
function krwPer(cur) {
  const s = state.settings;
  if (cur === 'KRW') return 1;
  if (cur === 'CNY') return Number(s.liveRate);
  const fx = s.fx || {};
  if (fx[cur]) return fx[cur];
  if (cur === 'USD') return Number(s.usdRate) || null;
  return null;
}
function priceKrw(it) {
  if (it.price == null || isNaN(it.price)) return null;
  const r = krwPer(curOf(it));
  return r ? it.price * r : null;
}
function priceCny(it) {
  const k = priceKrw(it);
  return k == null ? null : k / state.settings.liveRate;
}
function fmtPrice(it) {
  if (it.price == null) return '가격 확인';
  const cur = curOf(it);
  if (cur === 'KRW') return won(it.price);
  return (CUR_SYM[cur] || cur + ' ') + it.price;
}
function calc(it) {
  const s = state.settings;
  const krw = priceKrw(it);
  if (krw == null) return null;
  // 위안이 아닌 통화(달러 등)는 위안으로 바꾼 뒤 공식 적용
  const cny = curOf(it) === 'CNY' ? it.price : priceCny(it);
  const total = isDirect(it)
    ? krw + Number(s.aliShip || 0)
    : (cny + Number(s.localShip)) * Number(s.calcRate) + Number(s.shipBurden);
  const div = 1 - (Number(s.feePct) + Number(s.marginPct)) / 100;
  if (div <= 0) return null;
  const r = Math.max(1, Number(s.roundTo) || 1);
  const sell = Math.ceil(total / div / r) * r;
  const profit = sell * (1 - Number(s.feePct) / 100) - total;
  return { total, sell, profit };
}

// ---------- 설정 ----------
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  state.settings = { ...DEFAULTS, ...(settings || {}) };
  $('#src1688').checked = state.settings.src1688;
  $('#srcTaobao').checked = state.settings.srcTaobao;
  $('#srcAli').checked = state.settings.srcAli;
  $('#sort').value = state.settings.sort;
  setView(state.settings.view, false);
}
async function saveSettings(patch) {
  Object.assign(state.settings, patch || {});
  await chrome.storage.local.set({ settings: state.settings });
}

async function refreshRate() {
  const s = state.settings;
  const fresh = Date.now() - (s.fxTs || 0) < 6 * 3600 * 1000;
  if (!fresh || !s.fx) {
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/CNY');
      const j = await r.json();
      const rt = j?.rates;
      if (rt?.KRW) {
        const fx = {};
        for (const c of ['USD', 'EUR', 'GBP', 'JPY', 'HKD', 'TWD']) if (rt[c]) fx[c] = Math.round((rt.KRW / rt[c]) * 1000) / 1000;
        const patch = { fx, fxTs: Date.now(), usdRate: fx.USD || s.usdRate };
        if (!s.liveRateManual) Object.assign(patch, { liveRate: Math.round(rt.KRW * 100) / 100, liveRateTs: Date.now() });
        await saveSettings(patch);
        render(false);
      }
    } catch (e) {}
  }
  showRate();
}
function showRate() {
  const s = state.settings;
  const when = s.liveRateManual ? '직접 입력' : s.liveRateTs ? new Date(s.liveRateTs).toLocaleDateString('ko-KR') + ' 기준' : '기본값';
  const usd = krwPer('USD');
  $('#rateInfo').textContent = `1위안 ≈ ${s.liveRate}원${usd ? ` · 1달러 ≈ ${Math.round(usd).toLocaleString('ko-KR')}원` : ''} (${when}) · 판매가 계산 ${s.calcRate}원/위안`;
}

function openSettings() {
  const s = state.settings;
  $('#sLive').value = s.liveRate;
  $('#sCalcRate').value = s.calcRate;
  $('#sLocal').value = s.localShip;
  $('#sShip').value = s.shipBurden;
  $('#sFee').value = s.feePct;
  $('#sMargin').value = s.marginPct;
  $('#sRound').value = s.roundTo;
  $('#sAliShip').value = s.aliShip;
  $('#sClose').checked = s.closeTabs;
  $('#sFg').checked = s.foreground;
  $('#settingsDlg').showModal();
}
$('#btnSettings').onclick = openSettings;
$('#sReset').onclick = () => {
  const d = DEFAULTS;
  $('#sCalcRate').value = d.calcRate;
  $('#sLocal').value = d.localShip;
  $('#sShip').value = d.shipBurden;
  $('#sFee').value = d.feePct;
  $('#sMargin').value = d.marginPct;
  $('#sRound').value = d.roundTo;
  $('#sAliShip').value = d.aliShip;
  $('#sClose').checked = d.closeTabs;
  $('#sFg').checked = d.foreground;
};
$('#settingsDlg').addEventListener('close', async () => {
  if ($('#settingsDlg').returnValue !== 'ok') return;
  const live = parseFloat($('#sLive').value);
  const patch = {
    calcRate: parseFloat($('#sCalcRate').value) || DEFAULTS.calcRate,
    localShip: parseFloat($('#sLocal').value) || 0,
    shipBurden: parseFloat($('#sShip').value) || 0,
    feePct: parseFloat($('#sFee').value) || 0,
    marginPct: parseFloat($('#sMargin').value) || 0,
    roundTo: parseFloat($('#sRound').value) || 100,
    aliShip: parseFloat($('#sAliShip').value) || 0,
    closeTabs: $('#sClose').checked,
    foreground: $('#sFg').checked,
  };
  if (live && live !== state.settings.liveRate) Object.assign(patch, { liveRate: live, liveRateManual: true });
  await saveSettings(patch);
  showRate();
  render();
  toast('설정을 저장했어요');
});

// ---------- 이미지 입력 ----------
async function blobToJpeg(blob, max) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', max > 400 ? 0.92 : 0.8);
}
async function dataUrlToBlob(u) {
  return (await fetch(u)).blob();
}

async function useImage(blob) {
  if (!blob || !/^image\//.test(blob.type || 'image/')) return toast('이미지 파일이 아니에요');
  try {
    const dataUrl = await blobToJpeg(blob, 1000);
    const thumb = await blobToJpeg(blob, 220);
    state.lastImage = { dataUrl, thumb };
    $('#preview').src = dataUrl;
    $('#preview').classList.remove('hidden');
    $('#btnSearch').disabled = false;
    await startSearch();
  } catch (e) {
    toast('이미지를 읽지 못했어요: ' + e.message);
  }
}

async function useImageUrl(url) {
  toast('이미지 가져오는 중…');
  const r = await send({ type: 'fetchImage', url });
  if (!r || r.error) return toast('이미지를 가져오지 못했어요' + (r?.error ? ': ' + r.error : ''));
  await useImage(await dataUrlToBlob(r.dataUrl));
}

async function startSearch() {
  if (!state.lastImage) return;
  const sources = [];
  if ($('#src1688').checked) sources.push('1688');
  if ($('#srcTaobao').checked) sources.push('taobao');
  if ($('#srcAli').checked) sources.push('ali');
  if (!sources.length) return toast('검색할 사이트를 하나 이상 선택해 주세요');
  state.viewing = null;
  state.tr.clear();
  await send({ type: 'startSearch', dataUrl: state.lastImage.dataUrl, thumb: state.lastImage.thumb, sources });
}

document.addEventListener('paste', async (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const img = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  if (img) {
    e.preventDefault();
    return useImage(img.getAsFile());
  }
  if (e.target.matches('input, textarea')) return;
  const text = e.clipboardData?.getData('text') || '';
  if (/^https?:\/\/\S+$/i.test(text.trim())) {
    e.preventDefault();
    useImageUrl(text.trim());
  }
});

const drop = $('#drop');
drop.onclick = () => $('#file').click();
drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') $('#file').click(); };
$('#file').onchange = (e) => { const f = e.target.files[0]; if (f) useImage(f); e.target.value = ''; };
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) return useImage(f);
  const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  const html = e.dataTransfer.getData('text/html');
  const src = (html.match(/<img[^>]+src="([^"]+)"/i) || [])[1] || uri;
  if (src && /^(https?:|data:)/.test(src)) useImageUrl(src.replace(/&amp;/g, '&'));
});

$('#btnSearch').onclick = startSearch;
$('#src1688').onchange = () => saveSettings({ src1688: $('#src1688').checked });
$('#srcTaobao').onchange = () => saveSettings({ srcTaobao: $('#srcTaobao').checked });
$('#srcAli').onchange = () => saveSettings({ srcAli: $('#srcAli').checked });

// 우클릭 메뉴로 들어온 이미지
async function checkPending() {
  const { pendingImage } = await chrome.storage.local.get('pendingImage');
  if (!pendingImage || Date.now() - pendingImage.ts > 60000) return;
  await chrome.storage.local.remove('pendingImage');
  if (pendingImage.error) return toast(pendingImage.error);
  await useImage(await dataUrlToBlob(pendingImage.dataUrl));
}

// ---------- 상태 표시 ----------
const STATUS_TEXT = { pending: '탭 여는 중', uploading: '이미지 올리는 중', reading: '결과 읽는 중' };
function renderStatus() {
  const box = $('#status');
  const job = state.job;
  if (!job) { box.innerHTML = ''; return; }
  const elapsed = (Date.now() - job.ts) / 1000;
  box.innerHTML = job.sources
    .map((src) => {
      const st = job.status[src];
      const n = job.results[src]?.length;
      let msg, cls = '';
      if (st === 'done') {
        cls = 'done';
        msg = n ? `${n}개 찾음` : esc(job.errors[src] || '결과 없음');
      } else if (st === 'error') {
        cls = 'error';
        msg = esc(job.errors[src] || '오류');
      } else {
        msg = `<span class="spin"></span>${STATUS_TEXT[st] || st}`;
        if (elapsed > 40) msg += ` · <button class="link" data-focus="${src}">탭 열어서 확인</button>`;
      }
      if (st === 'error' || (st === 'done' && !n)) msg += ` · <button class="link" data-focus="${src}">탭 보기</button>`;
      return `<div class="st ${cls}"><span class="name"><span class="dot d${src}"></span>${SRC_NAME[src]}</span><span class="msg">${msg}</span></div>`;
    })
    .join('');
  box.querySelectorAll('[data-focus]').forEach((b) => (b.onclick = () => send({ type: 'focusSource', source: b.dataset.focus })));
  const running = job.sources.some((s) => !['done', 'error'].includes(job.status[s]));
  clearInterval(state.timer);
  if (running) state.timer = setInterval(renderStatus, 5000);
}

// ---------- 최근 검색 ----------
function renderHistory() {
  const bar = $('#historyBar');
  if (!state.history.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const curId = state.viewing ? state.viewing.id : state.job?.id;
  $('#historyList').innerHTML = state.history
    .map((h) => {
      const n = Object.values(h.results || {}).reduce((a, r) => a + (r?.length || 0), 0);
      const t = new Date(h.ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<button class="hitem ${h.id === curId ? 'on' : ''}" data-h="${h.id}" title="${esc(t)} · ${n}개"><img src="${h.thumb || ''}" alt="" /></button>`;
    })
    .join('');
  $('#historyList').querySelectorAll('[data-h]').forEach((b) => {
    b.onclick = () => {
      const h = state.history.find((x) => x.id === b.dataset.h);
      if (!h) return;
      state.viewing = state.job && h.id === state.job.id ? null : h;
      state.tr.clear();
      if (h.thumb) { $('#preview').src = h.thumb; $('#preview').classList.remove('hidden'); }
      render();
    };
  });
}

// ---------- 번역 (크롬 내장 번역 기능, 무료/기기 내 처리) ----------
async function ensureTranslator() {
  if (state.translator) return state.translator;
  if (!('Translator' in self)) throw new Error('이 크롬 버전은 내장 번역을 지원하지 않아요 (Chrome 138 이상 필요)');
  const opts = { sourceLanguage: 'zh', targetLanguage: 'ko' };
  const avail = await Translator.availability(opts);
  if (avail === 'unavailable') throw new Error('중국어→한국어 번역을 쓸 수 없는 환경이에요');
  if (avail !== 'available') toast('번역 모델을 내려받는 중이에요 (처음 한 번만)', 5000);
  state.translator = await Translator.create(opts);
  return state.translator;
}
async function translateVisible(items) {
  if (!state.translate || !state.translator) return;
  const todo = items.filter((it) => it.source !== 'ali' && it.title && !state.tr.has(it.title)).slice(0, 150);
  for (const it of todo) {
    try {
      state.tr.set(it.title, await state.translator.translate(it.title));
    } catch (e) {
      state.tr.set(it.title, null);
    }
  }
  if (todo.length) render(false);
}
$('#trToggle').onchange = async (e) => {
  state.translate = e.target.checked;
  if (state.translate) {
    try {
      await ensureTranslator();
    } catch (err) {
      state.translate = false;
      e.target.checked = false;
      return toast(err.message, 4500);
    }
  }
  render();
};

// ---------- 결과 화면 ----------
function setView(v, rerender = true) {
  state.settings.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (rerender) { saveSettings({ view: v }); render(); }
}
document.querySelectorAll('#viewSeg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$('#sort').onchange = () => { saveSettings({ sort: $('#sort').value }); render(); };
['#kw', '#pmin', '#pmax'].forEach((s) => $(s).addEventListener('input', () => render(false)));

function filtered(items) {
  const kw = $('#kw').value.trim().toLowerCase();
  const min = parseFloat($('#pmin').value);
  const max = parseFloat($('#pmax').value);
  let out = items.filter((it) => {
    if (kw) {
      const hay = (it.title + ' ' + (state.tr.get(it.title) || '') + ' ' + it.shop).toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    const cny = priceCny(it);
    if (!isNaN(min) && (cny == null || cny < min)) return false;
    if (!isNaN(max) && (cny == null || cny > max)) return false;
    return true;
  });
  const sort = $('#sort').value;
  const p = (x) => priceKrw(x) ?? Infinity;
  if (sort === 'priceAsc') out.sort((a, b) => p(a) - p(b));
  else if (sort === 'priceDesc') out.sort((a, b) => (priceKrw(b) ?? -1) - (priceKrw(a) ?? -1));
  else if (sort === 'sales') out.sort((a, b) => salesNum(b.sales) - salesNum(a.sales));
  else out.sort((a, b) => a.rank - b.rank);
  return out;
}

function card(it, cheapest) {
  const c = calc(it);
  const badge =
    it.source === '1688'
      ? '<span class="badge b1688">1688</span>'
      : it.source === 'ali'
        ? '<span class="badge bali">알리</span>'
        : it.tmall
          ? '<span class="badge btmall">티몰</span>'
          : '<span class="badge btaobao">타오바오</span>';
  const mainPrice = esc(it.priceText || fmtPrice(it));
  const cur = curOf(it);
  const cny = priceCny(it);
  const orig = it.origText ? `<span class="orig-price">${esc(it.origText)}</span>` : '';
  const subPrice =
    cur === 'KRW'
      ? `${orig}<span class="krw">≈ ¥${cny != null ? cny.toFixed(1) : '-'}</span>`
      : cur === 'CNY'
        ? `${orig}<span class="krw">≈ ${won(priceKrw(it))}</span>`
        : `${orig}<span class="krw">≈ ${won(priceKrw(it))} · ¥${cny != null ? cny.toFixed(1) : '-'}</span>`;
  const tr = state.translate ? state.tr.get(it.title) : null;
  const titleHtml = tr ? `${esc(tr)}<span class="orig">${esc(it.title)}</span>` : esc(it.title);
  const meta = [it.moq && ko(it.moq), it.sales && ko(it.sales), it.location].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('');
  const tags = (it.tags || []).slice(0, 4).map((t) => `<span class="tag" title="${esc(t)}">${esc(ko(t))}</span>`).join('');
  return `
  <article class="card ${cheapest ? 'cheap' : ''}">
    <a class="thumb" href="${esc(it.url)}" target="_blank" rel="noreferrer">
      <img src="${esc(it.img)}" loading="lazy" alt="" />
      ${badge}<span class="rank">#${it.rank}</span>
    </a>
    <div class="body">
      <a class="title" href="${esc(it.url)}" target="_blank" rel="noreferrer" title="${esc(it.title)}">${titleHtml}</a>
      <div class="price"><span class="cny">${mainPrice}</span>${subPrice}${cheapest ? '<span class="cheap-label">최저가</span>' : ''}</div>
      ${c ? `<div class="sell">예상 판매가 <b>${won(c.sell)}</b> · 순이익 ${won(c.profit)}${isDirect(it) ? ' · 직배송' : ''}</div>` : ''}
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      <div class="shop" title="${esc(it.shop)}">${esc(it.shopAge ? it.shopAge.replace('入驻', '입점 ').replace('年', '년') + ' · ' : '')}${esc(it.shop || '')}</div>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
    </div>
  </article>`;
}

function colHead(src, all, shown, url) {
  const withP = all.filter((x) => priceKrw(x) != null);
  const minIt = withP.length ? withP.reduce((a, b) => (priceKrw(b) < priceKrw(a) ? b : a)) : null;
  const minTxt = !minIt ? '' : isKrw(minIt) ? `최저 ${won(minIt.price)}` : `최저 ${esc(fmtPrice(minIt))} (≈ ${won(priceKrw(minIt))})`;
  return `<div class="col-head"><h2><span class="dot d${src}"></span>${SRC_NAME[src]} <span class="sum">${shown.length}/${all.length}개</span></h2>
    <span class="sum">${minTxt}
    ${url && src !== 'taobao' ? ` · <a href="${esc(url)}" target="_blank" rel="noreferrer">원본 결과</a>` : ''}</span></div>`;
}
const minKrw = (list) => Math.min(...list.map((x) => priceKrw(x) ?? Infinity));

function render(withTranslate = true) {
  const src = state.viewing || state.job;
  renderStatus();
  renderHistory();
  const box = $('#results');
  if (!src || !Object.keys(src.results || {}).length) {
    const running = state.job && !state.viewing && state.job.sources.some((s) => !['done', 'error'].includes(state.job.status[s]));
    box.innerHTML = `<div class="empty"><p>${running ? '<span class="spin"></span> 검색 중이에요. 보통 10~20초 걸려요.' : '이미지를 붙여넣으면 여기에 결과가 나와요.'}</p></div>`;
    $('#count').textContent = '';
    return;
  }
  const results = src.results;
  const all = Object.values(results).flat();
  const shownAll = [];

  if (state.settings.view === 'merged') {
    const shown = filtered(all);
    shownAll.push(...shown);
    const minP = minKrw(shown);
    box.className = 'results merged';
    box.innerHTML = `<div class="grid">${shown.map((it) => card(it, priceKrw(it) === minP)).join('')}</div>`;
  } else {
    box.className = 'results';
    const order = SRC_ORDER.filter((s) => results[s]);
    box.innerHTML = `<div class="cols n${order.length}">${order
      .map((s) => {
        const items = results[s] || [];
        const shown = filtered(items);
        shownAll.push(...shown);
        const minP = minKrw(shown);
        return `<section class="col">${colHead(s, items, shown, src.urls?.[s])}<div class="grid">${shown.map((it) => card(it, priceKrw(it) === minP)).join('')}</div></section>`;
      })
      .join('')}</div>`;
  }
  $('#count').textContent = `${shownAll.length}개 표시 / 전체 ${all.length}개`;
  if (withTranslate && state.translate) translateVisible(shownAll);
}

// ---------- 저장소 변화 감지 ----------
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.job) {
    state.job = ch.job.newValue || null;
    if (!state.viewing) render();
  }
  if (ch.history) {
    state.history = ch.history.newValue || [];
    renderHistory();
  }
  if (ch.pendingImage?.newValue) checkPending();
});

(async function init() {
  await loadSettings();
  const { job, history } = await chrome.storage.local.get(['job', 'history']);
  state.job = job || null;
  state.history = history || [];
  if (state.job?.thumb) {
    $('#preview').src = state.job.dataUrl || state.job.thumb;
    $('#preview').classList.remove('hidden');
    state.lastImage = { dataUrl: state.job.dataUrl, thumb: state.job.thumb };
    $('#btnSearch').disabled = !state.job.dataUrl;
  }
  render();
  refreshRate();
  checkPending();
})();
