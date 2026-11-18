// 페이지(MAIN) 영역에서 실행: 알리익스프레스 이미지검색 결과의 내부 상품 목록(itemList)을 읽어
// 확장 프로그램 스크립트가 읽을 수 있도록 DOM 속성에 넣어준다.
// (화면에는 10여 개만 그려져 있어도 내부 데이터에는 60개가 들어 있음)
(() => {
  function findList() {
    const cards = document.querySelectorAll('a.search-card-item, a[href*="/item/"]');
    for (const a of cards) {
      const key = Object.keys(a).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      let f = key ? a[key] : null;
      for (let i = 0; f && i < 25; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && Array.isArray(p.itemList) && p.itemList.length) return p.itemList;
      }
    }
    return null;
  }

  document.addEventListener('isearch-collect', () => {
    let out = [];
    try {
      const list = findList() || [];
      out = list
        .filter((x) => x && x.productId)
        .map((x) => ({
          id: String(x.productId),
          title: x.title?.displayTitle || '',
          img: x.image?.imgUrl || '',
          sale: x.prices?.salePrice?.minPrice ?? null,
          orig: x.prices?.originalPrice?.minPrice ?? null,
          currency: x.prices?.salePrice?.currencyCode || x.prices?.originalPrice?.currencyCode || 'KRW',
          discount: x.prices?.salePrice?.discount ?? null,
          trade: x.trade?.tradeDesc || '',
          tags: (x.sellingPoints || []).map((s) => s?.tagContent?.tagText).filter(Boolean),
          rating: x.evaluation?.starRating ?? null,
        }));
    } catch (e) {}
    document.documentElement.setAttribute('data-isearch-items', JSON.stringify(out));
  });
})();
