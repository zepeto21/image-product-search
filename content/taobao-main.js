// 페이지(MAIN) 영역에서 실행: 타오바오 검색 카드의 내부 데이터(사진 주소, 가격 등)를 읽어
// 확장 프로그램 스크립트가 읽을 수 있도록 DOM 속성에 넣어준다.
// (화면 밖 상품은 사진이 늦게 로드되기 때문에, 백그라운드 탭에서도 사진을 얻기 위함)
(() => {
  const parse = (v) => {
    if (!v) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (e) { return null; }
  };
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '');

  document.addEventListener('isearch-collect', () => {
    const out = {};
    document.querySelectorAll('a[id^="item_id_"]').forEach((a) => {
      try {
        const key = Object.keys(a).find((k) => k.startsWith('__reactFiber'));
        let f = key ? a[key] : null;
        let d = null;
        for (let i = 0; f && i < 10; i++, f = f.return) {
          const p = f.memoizedProps;
          if (p && p.data && (p.data.item_id || p.data.pic_path)) { d = p.data; break; }
        }
        if (!d) return;
        const ps = parse(d.priceShow);
        const si = parse(d.shopInfo);
        out[a.id.replace('item_id_', '')] = {
          pic: d.pic_path || '',
          price: ps?.price || d.price || '',
          title: strip(d.title),
          sales: d.realSales || '',
          procity: d.procity || '',
          shop: strip(si?.title || d.nick || ''),
          shopTag: d.shopTag || '',
        };
      } catch (e) {}
    });
    document.documentElement.setAttribute('data-isearch-items', JSON.stringify(out));
  });
})();
