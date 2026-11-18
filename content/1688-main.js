// 페이지(MAIN) 영역에서 실행: 1688이 검색 결과를 새 창(window.open)으로 열려고 할 때
// 확장 프로그램이 검색 중이면 같은 탭에서 열도록 바꾼다. (자동 클릭이라 팝업이 차단되는 문제 방지)
(() => {
  const origOpen = window.open;
  window.open = function (url, ...rest) {
    try {
      if (url && document.documentElement.hasAttribute('data-isearch')) {
        document.documentElement.removeAttribute('data-isearch');
        location.href = new URL(String(url), location.href).href;
        return null;
      }
    } catch (e) {}
    return origOpen.call(this, url, ...rest);
  };
})();
