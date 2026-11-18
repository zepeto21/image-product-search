// 타오바오: s.taobao.com 검색 페이지에서 이미지 업로드 -> 같은 페이지에서 결과 추출
(async () => {
  const SRC = 'taobao';
  const isImgResult = () => /localImgKey|imgSearch|picurl|imageId/i.test(location.search);

  // 페이지 내부 데이터 (taobao-main.js가 채워줌)
  function pageData() {
    try {
      document.dispatchEvent(new CustomEvent('isearch-collect'));
      const raw = document.documentElement.getAttribute('data-isearch-items');
      document.documentElement.removeAttribute('data-isearch-items');
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function extract() {
    const seen = new Set();
    const out = [];
    const pd = pageData();
    document.querySelectorAll('a[id^="item_id_"]').forEach((c) => {
      const id = c.id.replace('item_id_', '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      const q = (s) => c.querySelector(s);
      const pi = IS.text(q('[class*="priceInt"]'));
      const pf = IS.text(q('[class*="priceFloat"]'));
      const unit = IS.text(q('[class*="unit--"]')) || '¥';
      const priceText = pi ? unit + pi + pf : '';
      const titleEl = q('[class*="title--"]');
      const href = IS.abs(c.getAttribute('href') || '');
      const shopEl = q('[class*="shopName"]');
      const d = pd[id] || {};
      const domImg = q('img[class*="mainPic"]')?.getAttribute('src') || '';
      const img = domImg || (d.pic ? IS.abs(d.pic) + '_460x460q90.jpg' : '');
      const tags = [...new Set([...c.querySelectorAll('[class*="subIconWrapper"] span, [class*="iconWrapper"] span')].map(IS.text))].filter(Boolean);
      out.push({
        source: SRC,
        rank: out.length + 1,
        id,
        title: titleEl?.getAttribute('title') || IS.text(titleEl) || d.title || '',
        price: IS.num(pi + pf) ?? IS.num(d.price),
        currency: IS.cur(unit) || 'CNY',
        priceText: priceText || (d.price ? '¥' + d.price : ''),
        moq: '',
        sales: IS.text(q('[class*="realSales"]')) || d.sales || '',
        tags: d.shopTag ? [...tags, d.shopTag] : tags,
        shop: IS.text(shopEl) || d.shop || '',
        shopAge: '',
        location: [...c.querySelectorAll('[class*="procity"]')].map(IS.text).join(' ') || d.procity || '',
        tmall: /tmall\.com/.test(href),
        img,
        url: /tmall\.com/.test(href)
          ? `https://detail.tmall.com/item.htm?id=${id}`
          : /item\.taobao\.com/.test(href)
            ? `https://item.taobao.com/item.htm?id=${id}`
            : href,
      });
    });
    return out;
  }

  async function readResults() {
    IS.send({ type: 'progress', source: SRC, status: 'reading' });
    const found = await IS.waitFor(() => document.querySelector('a[id^="item_id_"]'), 30000);
    if (!found) {
      IS.send({ type: 'results', source: SRC, url: location.href, items: [], note: '결과가 없거나 로그인이 필요해요' });
      return;
    }
    await IS.sleep(1500);
    IS.send({ type: 'results', source: SRC, url: location.href, items: extract() });
  }

  // 결과 페이지로 바로 열린 경우 (새로고침 등)
  if (isImgResult()) {
    const ok = await IS.send({ type: 'isJobTab', source: SRC });
    if (ok) await readResults();
    return;
  }

  // 검색 작업 탭이면 업로드
  const task = await IS.send({ type: 'getTask', source: SRC });
  if (!task || !task.dataUrl) return;

  const icon = await IS.waitFor(() => document.querySelector('.image-search-icon-outerMode, [class*="image-search-icon"]'), 20000);
  if (icon) icon.click();
  await IS.sleep(800);

  const input = await IS.waitFor(() => document.getElementById('image-search-custom-file-input'), 15000);
  if (!input) {
    IS.send({ type: 'taskError', source: SRC, error: '타오바오 이미지 업로드 칸을 찾지 못했어요 (로그인 확인)' });
    return;
  }
  IS.setFile(input, IS.dataUrlToFile(task.dataUrl));

  const btn = await IS.waitFor(() => document.querySelector('.upload-button.upload-button-active'), 20000);
  if (!btn) {
    IS.send({ type: 'taskError', source: SRC, error: '타오바오 이미지 업로드가 끝나지 않았어요 (탭을 열어 확인)' });
    return;
  }
  btn.click();

  // 타오바오는 같은 페이지 안에서 주소만 바뀌고 결과가 다시 그려진다
  const moved = await IS.waitFor(() => isImgResult(), 15000, 250);
  if (!moved) {
    IS.send({ type: 'taskError', source: SRC, error: '타오바오 결과로 넘어가지 못했어요 (탭을 열어 확인)' });
    return;
  }
  await readResults();
})();
