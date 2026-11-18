// 1688: 홈에서 이미지 업로드 -> 결과 페이지에서 상품 목록 추출
(async () => {
  const SRC = '1688';

  function extract() {
    const seen = new Set();
    const out = [];
    document.querySelectorAll('[data-renderkey]').forEach((c) => {
      const id = (c.getAttribute('data-renderkey').match(/_(\d{6,})$/) || [])[1];
      if (!id || seen.has(id)) return;
      seen.add(id);
      const q = (s) => c.querySelector(s);
      const priceText = IS.text(q('[class*="priceItem"]')).replace(/\s/g, '');
      const after = [...new Set([...c.querySelectorAll('[class*="colDescAfter"] [class*="descText"]')].map(IS.text))].filter(Boolean);
      const moq = after.find((t) => /起批|起订|起售|件起/.test(t)) || '';
      const sales = after.filter((t) => t !== moq).join(' ');
      const tags = [...new Set([...c.querySelectorAll('[class*="offerTagRow"] [class*="descText"]')].map(IS.text))].filter(Boolean);
      const shopRaw = IS.text(q('[class*="offerShopRow"]')).replace(/旺旺(在线|离线)/g, '').trim();
      const years = (shopRaw.match(/^入驻\d+年/) || [''])[0];
      const shop = shopRaw.replace(/^入驻\d+年/, '').trim();
      out.push({
        source: SRC,
        rank: out.length + 1,
        id,
        title: IS.text(q('[class*="titleText"]')),
        price: IS.num(priceText),
        currency: IS.cur(priceText) || 'CNY',
        priceText,
        moq,
        sales,
        tags,
        shop,
        shopAge: years,
        location: '',
        img: IS.img(q('img')?.getAttribute('src')),
        url: `https://detail.1688.com/offer/${id}.html`,
      });
    });
    return out;
  }

  // 1) 홈페이지: 검색 작업이 있으면 업로드
  if (location.hostname === 'www.1688.com') {
    const task = await IS.send({ type: 'getTask', source: SRC });
    if (!task || !task.dataUrl) return;

    const input = await IS.waitFor(
      () =>
        document.querySelector('input.image-file-reader-wrapper') ||
        document.querySelector('.image-upload-button-container input[type=file]'),
      20000
    );
    if (!input) {
      IS.send({ type: 'taskError', source: SRC, error: '1688 이미지 업로드 버튼을 찾지 못했어요 (로그인 또는 페이지 변경 확인)' });
      return;
    }
    document.documentElement.setAttribute('data-isearch', '1');
    IS.setFile(input, IS.dataUrlToFile(task.dataUrl));

    const btn = await IS.waitFor(
      () => [...document.querySelectorAll('div,span,button')].find((d) => d.childElementCount === 0 && IS.text(d) === '搜索图片'),
      20000
    );
    if (!btn) {
      IS.send({ type: 'taskError', source: SRC, error: '1688 이미지 업로드가 끝나지 않았어요 (탭을 열어 확인)' });
      return;
    }
    btn.click();

    // 정상이라면 이 페이지는 곧 결과 페이지로 이동한다
    await IS.sleep(15000);
    if (location.hostname === 'www.1688.com') {
      IS.send({ type: 'taskError', source: SRC, error: '결과 페이지로 이동하지 못했어요 (캡차가 떴는지 탭을 열어 확인)' });
    }
    return;
  }

  // 2) 결과 페이지: 이 탭이 검색 작업 탭이면 상품 추출
  const ok = await IS.send({ type: 'isJobTab', source: SRC });
  if (!ok) return;
  IS.send({ type: 'progress', source: SRC, status: 'reading' });
  const found = await IS.waitFor(() => document.querySelector('[data-renderkey]'), 30000);
  if (!found) {
    IS.send({ type: 'results', source: SRC, url: location.href, items: [], note: '결과가 없거나 페이지가 늦게 열렸어요' });
    return;
  }
  await IS.sleep(1200);
  IS.send({ type: 'results', source: SRC, url: location.href, items: extract() });
})();
