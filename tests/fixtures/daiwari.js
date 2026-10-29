// A made-up 128-page 台割 (same columns as a real one, no real content) used by the browser tests.
const SECTIONS = ['SECTION 0 INTRODUCTION', 'SECTION 1 MESSAGE', 'SECTION 2 LEARNING', 'SECTION 3 PEOPLE', 'SECTION 4 CAMPUS', 'SECTION 5 INFORMATION'];
const KINDS = ['イントロ', 'メッセージ', '学びの紹介', 'インタビュー', 'キャンパス紹介', '資料'];
const pad = (n) => String(n).padStart(3, '0');
module.exports = function daiwari() {
  const rows = [['頁', '左右', 'セクション', '種別', '内容', '備考', '初校', '原稿種別', '写真種別', '写真／図版の内容']];
  rows.push(['表1', '単', '', '表紙', '', 'サンプルの備考', '調整中', '新規ライティング', '未定']);
  rows.push(['表2', '左', '', '表2（見返し）', '', '', '調整中', '新規ライティング', '未定']);
  for (let p = 1; p <= 128; p++) {
    const s = p === 1 ? -1 : Math.min(SECTIONS.length - 1, Math.floor((p - 2) / 22));
    rows.push([pad(p), p % 2 ? '右' : '左', s < 0 ? '' : SECTIONS[s], s < 0 ? '扉' : KINDS[s], s < 0 ? '' : 'サンプル内容 ' + p, '', p < 40 ? '未／着手OK' : '未／待ち', p % 3 ? '昨年原稿' : '新規ライティング', '未定']);
  }
  rows.push(['表3', '右', '', '表3（見返し）', '', '', '', '', '']);
  rows.push(['表4', '単', '', '表4', '', '', '', '', '']);
  rows.push([], ['', '', '昨年と異なる台割'], ['', '', '昨年ベースの台割']);
  return rows;
};
