// 알리익스프레스: 홈에서 이미지 업로드 -> (같은 탭) 결과 페이지에서 상품 추출
(async () => {
  const SRC = 'ali';
  const isResult = () => /isNewImageSearch=y|imageId=|filename=/i.test(location.search) && /\/w\//.test(location.pathname);

  function pageData() {
    try {
      document.dispatchEvent(new CustomEvent('isearch-collect'));
      const raw = document.documentElement.getAttribute('data-isearch-items');
      document.documentElement.removeAttribute('data-isearch-items');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  // 내부 데이터를 못 읽었을 때: 화면에 그려진 카드에서라도 읽기
  function fromDom() {
    return [...document.querySelectorAll('a.search-card-item, a[href*="/item/"]')]
      .map((a) => {
        const id = (a.getAttribute('href') || '').match(/\/item\/(\d+)\.html/)?.[1];
        if (!id) return null;
        const priceEl = a.querySelector('[class*="price-sale"]') || a.querySelector('[class*="price"]');
        const origEl = a.querySelector('[class*="price-original"]');
        return {
          id,
          title: a.querySelector('h3')?.textContent.trim() || a.querySelector('[title]')?.getAttribute('title') || '',
          img: a.querySelector('img')?.getAttribute('src') || '',
          sale: IS.num(priceEl?.getAttribute('aria-label') || priceEl?.textContent),
          orig: IS.num(origEl?.textContent),
          currency: 'KRW',
          trade: IS.text(a.querySelector('[class*="trade"]')),
          tags: [],
        };
      })
      .filter(Boolean);
  }

  function extract() {
    let raw = pageData();
    if (!raw.length) raw = fromDom();
    const seen = new Set();
    const out = [];
    for (const x of raw) {
      if (!x.id || seen.has(x.id)) continue;
      seen.add(x.id);
      const cur = x.currency || 'KRW';
      const sym = cur === 'KRW' ? '₩' : cur === 'USD' ? '$' : cur === 'CNY' ? '¥' : cur + ' ';
      const fmt = (n) => (n == null ? '' : sym + Number(n).toLocaleString('ko-KR'));
      const price = x.sale ?? x.orig ?? null;
      out.push({
        source: SRC,
        rank: out.length + 1,
        id: x.id,
        title: x.title,
        price,
        currency: cur,
        priceText: fmt(price),
        origText: x.orig && x.sale && x.orig > x.sale ? fmt(x.orig) : '',
        moq: '',
        sales: x.trade || '',
        tags: x.tags || [],
        shop: '',
        shopAge: '',
        location: '',
        img: IS.abs(x.img || '').replace(/(\.(jpg|jpeg|png|webp))$/i, '$1_350x350.jpg'),
        url: `https://ko.aliexpress.com/item/${x.id}.html`,
      });
    }
    return out;
  }

  // 1) 결과 페이지
  if (isResult()) {
    const ok = await IS.send({ type: 'isJobTab', source: SRC });
    if (!ok) return;
    IS.send({ type: 'progress', source: SRC, status: 'reading' });
    const found = await IS.waitFor(() => document.querySelector('a.search-card-item, a[href*="/item/"]'), 30000);
    if (!found) {
      IS.send({ type: 'results', source: SRC, url: location.href, items: [], note: '결과가 없거나 로그인 창이 떠 있어요' });
      return;
    }
    await IS.sleep(1500);
    IS.send({ type: 'results', source: SRC, url: location.href, items: extract() });
    return;
  }

  // 2) 홈: 검색 작업이 있으면 업로드
  const task = await IS.send({ type: 'getTask', source: SRC });
  if (!task || !task.dataUrl) return;

  const btn = await IS.waitFor(
    () => document.querySelector('[aria-label="이미지로 검색하기"], [class*="picture-search-btn"]'),
    20000
  );
  if (btn) btn.click();
  const input = await IS.waitFor(
    () => document.querySelector('[class*="upload-content"] input[type=file]') || document.querySelector('input[type=file][accept*="jpg"]'),
    15000
  );
  if (!input) {
    IS.send({ type: 'taskError', source: SRC, error: '알리 이미지 업로드 칸을 찾지 못했어요 (탭을 열어 확인)' });
    return;
  }
  IS.setFile(input, IS.dataUrlToFile(task.dataUrl));

  // 정상이라면 곧 결과 페이지로 이동한다
  await IS.sleep(20000);
  if (!isResult()) {
    IS.send({ type: 'taskError', source: SRC, error: '알리 결과 페이지로 넘어가지 못했어요 (로그인 창이나 캡차 확인)' });
  }
})();
