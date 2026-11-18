// 공통 도우미 (1688 / 타오바오 콘텐츠 스크립트에서 함께 사용)
var IS = globalThis.IS || {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

  async waitFor(fn, timeout = 20000, step = 300) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch (e) {}
      await IS.sleep(step);
    }
    return null;
  },

  dataUrlToFile(dataUrl, name = 'search.jpg') {
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], name, { type: mime });
  },

  setFile(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },

  send(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (e) {
      return Promise.resolve(null);
    }
  },

  text(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  },

  num(s) {
    const m = String(s || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  },

  // 가격 표시에서 통화 알아내기 (사이트 설정에 따라 ¥ / $ / ₩ 등으로 바뀜)
  cur(t) {
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
  },

  abs(u) {
    if (!u) return '';
    if (u.startsWith('//')) return 'https:' + u;
    return u;
  },

  // 썸네일 접미사(_460x460q100.jpg_.webp 등)를 정리해서 적당한 크기로
  img(u) {
    u = IS.abs(u || '');
    return u;
  },
};
globalThis.IS = IS;
