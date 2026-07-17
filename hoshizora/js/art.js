// art.js — 自作SVGアート（スート記号・カード・キャラ・装飾）
// すべてインラインSVG。色は CSS 変数 or currentColor で制御。

// ---- スート記号（viewBox 0 0 32 32, fill=currentColor） ----------------------
// 塗りは各スートの ink 色、内側ハイライトで立体感を出す。

const SUIT_PATHS = {
  // 丸みのある5角星＋中央ハイライト
  star: `<path d="M16 3.2c.55 0 1.05.33 1.27.85l2.83 6.66 7.2.62c1.16.1 1.63 1.55.75 2.31l-5.47 4.72 1.65 7.04c.26 1.13-.96 2.02-1.96 1.42L16 23.02l-6.26 3.82c-1 .6-2.22-.29-1.96-1.42l1.65-7.04-5.47-4.72c-.88-.76-.41-2.21.75-2.31l7.2-.62 2.83-6.66c.22-.52.72-.85 1.27-.85z"/>
         <path d="M16 6.6l1.9 4.46 4.8.42-3.65 3.15 1.1 4.7L16 21.05z" opacity=".28" fill="#fff"/>`,
  // 三日月
  moon: `<path d="M18.4 4.3c-6.1-1.2-11.7 3.5-11.7 9.6 0 5.4 4.4 9.7 9.7 9.7 4.3 0 8-2.8 9.3-6.7-1.3.9-2.9 1.4-4.6 1.4-4.6 0-8.2-3.7-8.2-8.2 0-2.3.9-4.3 2.3-5.8.9-.9.2-.2 3.2 0z"/>
         <circle cx="21.5" cy="9.5" r="1.1" opacity=".5" fill="#fff"/>`,
  // ふんわり雲
  cloud: `<path d="M9 24c-3.3 0-6-2.6-6-5.9 0-3 2.2-5.5 5.2-5.9C9.4 8.9 12.5 6.5 16 6.5c4.2 0 7.7 3.2 8.1 7.3 2.8.2 5 2.6 5 5.4 0 2.9-2.4 4.8-5.3 4.8H9z"/>
          <ellipse cx="12" cy="15" rx="4" ry="3" opacity=".3" fill="#fff"/>`,
  // 風にそよぐ葉
  wind: `<path d="M25.5 5.2C15.3 5.7 7.5 10.8 6.6 19.6c-.3 2.9.6 5.4 2.1 7.2.5-4.9 3-9.3 8.4-13.2-4.2 4.2-6.3 8.7-6.7 13.9 8.8.4 15.4-6.6 15.9-16.9.05-1 0-2.3-.8-5.4z"/>
         <path d="M11 24c3-4.5 6.5-8 11-10.5" stroke="#fff" stroke-width="1.4" fill="none" opacity=".4" stroke-linecap="round"/>`,
  // 彗星（頭＋尾＋きらめき）
  comet: `<path d="M22 5.5c2.8 0 5 2.2 5 5 0 2.8-2.2 5-5 5-1.4 0-2.7-.6-3.6-1.5L6.5 27l9.1-12.3c-.4-.7-.6-1.6-.6-2.2 0-4 3.6-7 7-7z"/>
          <circle cx="22" cy="10.5" r="2.6" opacity=".45" fill="#fff"/>
          <path d="M9.5 6.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" opacity=".9"/>
          <path d="M26 20l.55 1.35L28 21.9l-1.45.55L26 23.8l-.55-1.35L24 21.9l1.45-.55z" opacity=".75"/>`,
};

export function suitGlyph(suit, cls = '') {
  return `<svg class="glyph ${cls}" viewBox="0 0 32 32" aria-hidden="true">${SUIT_PATHS[suit]}</svg>`;
}

// ---- 装飾 -------------------------------------------------------------------

// 飛行船（ゴンドラにクルー）— タイトル/マップ現在地用
export function airshipSVG(cls = '') {
  return `<svg class="airship-svg ${cls}" viewBox="0 0 120 80" aria-hidden="true">
    <defs><linearGradient id="balloonG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8FA9E0"/><stop offset="1" stop-color="#5C74B8"/></linearGradient></defs>
    <ellipse cx="60" cy="30" rx="38" ry="26" fill="url(#balloonG)"/>
    <ellipse cx="60" cy="30" rx="38" ry="26" fill="none" stroke="#42528C" stroke-width="1.5"/>
    <path d="M32 22q28 10 56 0" stroke="#fff" stroke-width="1.5" fill="none" opacity=".35"/>
    <path d="M30 34q30 9 60 0" stroke="#fff" stroke-width="1.5" fill="none" opacity=".25"/>
    <line x1="45" y1="53" x2="48" y2="62" stroke="#8A6A3A" stroke-width="1.5"/>
    <line x1="75" y1="53" x2="72" y2="62" stroke="#8A6A3A" stroke-width="1.5"/>
    <rect x="44" y="61" width="32" height="13" rx="5" fill="#C89B63"/>
    <rect x="44" y="61" width="32" height="13" rx="5" fill="none" stroke="#9A733F" stroke-width="1.2"/>
  </svg>`;
}

// シグナルランプ
export function lampSVG(cls = '') {
  return `<svg class="lamp-svg ${cls}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" fill="var(--c-glow)" stroke="#C9A24A" stroke-width="1.2"/>
    <rect x="9" y="16" width="6" height="2.4" rx="1" fill="#8A8A9A"/>
    <rect x="10" y="18.4" width="4" height="2.6" rx="1" fill="#6A6A7A"/>
  </svg>`;
}

// ---- キャラアバター（viewBox 0 0 100 100・透過背景・CSSの円地に重ねる） -------
// かわいさ最優先: 大きめの丸い頭・つぶらな目・チークで統一。

function face(eyes = 'dot', extra = '') {
  const eyeY = 54;
  let eyeEls;
  if (eyes === 'happy') {
    eyeEls = `<path d="M38 ${eyeY}q4 -5 8 0" stroke="#3B3B4F" stroke-width="3" fill="none" stroke-linecap="round"/>
              <path d="M54 ${eyeY}q4 -5 8 0" stroke="#3B3B4F" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  } else {
    eyeEls = `<ellipse cx="42" cy="${eyeY}" rx="3.6" ry="4.4" fill="#3B3B4F"/>
              <ellipse cx="58" cy="${eyeY}" rx="3.6" ry="4.4" fill="#3B3B4F"/>
              <circle cx="43.2" cy="52.4" r="1.3" fill="#fff"/><circle cx="59.2" cy="52.4" r="1.3" fill="#fff"/>`;
  }
  return `${eyeEls}
    <circle cx="35" cy="61" r="4" fill="#F6A9C0" opacity=".55"/>
    <circle cx="65" cy="61" r="4" fill="#F6A9C0" opacity=".55"/>
    ${extra}`;
}

const CHAR_SVG = {
  // ソラ（ねこ・クリーム/オレンジ）
  sora: `
    <path d="M28 30 L24 16 L40 27 Z" fill="#F4C88A"/><path d="M72 30 L76 16 L60 27 Z" fill="#F4C88A"/>
    <path d="M29 29 L27 20 L37 27 Z" fill="#F6A9C0"/><path d="M71 29 L73 20 L63 27 Z" fill="#F6A9C0"/>
    <circle cx="50" cy="55" r="33" fill="#F6D3A0"/>
    <circle cx="50" cy="55" r="33" fill="none" stroke="#E3B478" stroke-width="1.5"/>
    ${face('dot', `
      <path d="M50 60 l-2.5 3 h5 z" fill="#C9748C"/>
      <path d="M50 63 v3" stroke="#3B3B4F" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M25 57 h-9 M25 61 h-9" stroke="#E3B478" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M75 57 h9 M75 61 h9" stroke="#E3B478" stroke-width="1.4" stroke-linecap="round"/>`)}`,
  // ミミ（うさぎ・ピンク）
  mimi: `
    <ellipse cx="40" cy="20" rx="7" ry="18" fill="#FBE1EA"/><ellipse cx="60" cy="20" rx="7" ry="18" fill="#FBE1EA"/>
    <ellipse cx="40" cy="20" rx="3.4" ry="12" fill="#F6A9C0"/><ellipse cx="60" cy="20" rx="3.4" ry="12" fill="#F6A9C0"/>
    <circle cx="50" cy="57" r="32" fill="#FFF3F7"/>
    <circle cx="50" cy="57" r="32" fill="none" stroke="#F3C9D8" stroke-width="1.5"/>
    ${face('dot', `
      <path d="M50 62 l-2.2 2.6 h4.4 z" fill="#E88BA6"/>
      <path d="M50 64.6 v2.4 M50 67 q-3 2 -6 1 M50 67 q3 2 6 1" stroke="#D98FA6" stroke-width="1.3" fill="none" stroke-linecap="round"/>`)}`,
  // ペン（ぺんぎん・ブルー）
  pen: `
    <circle cx="50" cy="55" r="34" fill="#5C74B8"/>
    <circle cx="50" cy="55" r="34" fill="none" stroke="#42528C" stroke-width="1.5"/>
    <path d="M50 30 C33 30 27 50 30 66 C34 82 66 82 70 66 C73 50 67 30 50 30 Z" fill="#FBFAF7"/>
    ${face('dot', `
      <path d="M44 60 h12 l-6 6 z" fill="#F4A84C"/>
      <path d="M44 60 h12 l-6 3.2 z" fill="#E08C2E"/>`)}
    <ellipse cx="30" cy="72" rx="6" ry="3.5" fill="#F4A84C" transform="rotate(-18 30 72)"/>
    <ellipse cx="70" cy="72" rx="6" ry="3.5" fill="#F4A84C" transform="rotate(18 70 72)"/>`,
  // コロ（いぬ・グリーン/クリーム）
  koro: `
    <ellipse cx="26" cy="46" rx="10" ry="17" fill="#CDE9D8" transform="rotate(18 26 46)"/>
    <ellipse cx="74" cy="46" rx="10" ry="17" fill="#CDE9D8" transform="rotate(-18 74 46)"/>
    <circle cx="50" cy="55" r="33" fill="#EAF6EF"/>
    <circle cx="50" cy="55" r="33" fill="none" stroke="#B5DcC5" stroke-width="1.5"/>
    <path d="M38 52 a7 6 0 0 1 14 0 z" fill="#CDE9D8" opacity=".8"/>
    ${face('dot', `
      <ellipse cx="50" cy="61" rx="4" ry="3" fill="#3B3B4F"/>
      <path d="M50 64 v3 M50 67 q-4 2 -7 0 M50 67 q4 2 7 0" stroke="#6BA986" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M56 66 q6 1 9 -2" stroke="#E88BA6" stroke-width="2.4" fill="none" stroke-linecap="round"/>`)}`,
};

export function charSVG(key, cls = '') {
  return `<svg class="char-svg ${cls}" viewBox="0 0 100 100" aria-hidden="true">${CHAR_SVG[key]}</svg>`;
}

// 小さな星（背景装飾用）
export function tinyStar(size, color = 'var(--c-glow)') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" style="fill:${color}">${SUIT_PATHS.star}</svg>`;
}
