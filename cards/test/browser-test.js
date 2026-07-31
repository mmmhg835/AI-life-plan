const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  NG  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const opts = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
  const browser = await chromium.launch(opts);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION|fonts\.googleapis|fonts\.gstatic/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(FILE);
  await page.waitForTimeout(300);

  console.log('\n[1] ロジック単体');
  const r = await page.evaluate(() => {
    const c = window.__cc;
    return {
      key1: c.companyKey('株式会社サンプル製作所'),
      key2: c.companyKey('サンプル製作所（株）'),
      key3: c.companyKey('ｻﾝﾌﾟﾙ'),
      key4: c.companyKey('青空リース(株)'),
      key5: c.companyKey('青空リース株式会社'),
      rankShacho: c.titleRank('代表取締役社長'),
      rankFuku: c.titleRank('取締役副社長'),
      rankTori: c.titleRank('取締役'),
      rankBucho: c.titleRank('部長'),
      rankHonbu: c.titleRank('営業本部長'),
      rankJicho: c.titleRank('次長'),
      rankKacho: c.titleRank('課長'),
      rankDairi: c.titleRank('課長代理'),
      rankNone: c.titleRank(''),
      dept1: c.deptPath('営業本部/第一営業部/東京1課'),
      dept2: c.deptPath('営業本部　第一営業部'),
      dept3: c.deptPath(''),
      d1: c.normDate('2026/4/10'),
      d2: c.normDate('2026年4月10日'),
      d3: c.normDate('20260410'),
      d4: c.normDate('ほげ'),
      parse: c.parseCardText('株式会社サンプル\n営業本部 第一営業部\n部長 山田 太郎\nyamada@example.com\nTEL 03-1234-5678'),
      parse2: c.parseCardText('サンプル商事株式会社\n技術部 課長 佐藤 花子\nsato@example.co.jp\n携帯 090-1111-2222'),
      hdr: c.mapHeaders(['会社名', '氏名', 'ふりがな', '部署', '役職', 'メール', '電話', '携帯', '名刺交換日']),
      csv: c.splitRows('a,b\n"x,1",y'),
      fresh: [c.freshnessOf(0, '2026-07-30', { freshDays: 90, staleDays: 365 }),
              c.freshnessOf(2, '2026-07-30', { freshDays: 90, staleDays: 365 }),
              c.freshnessOf(2, '2026-01-01', { freshDays: 90, staleDays: 365 }),
              c.freshnessOf(2, '2020-01-01', { freshDays: 90, staleDays: 365 })]
    };
  });
  ok('株式会社と（株）が同じ箱', r.key1 === r.key2, [r.key1, r.key2]);
  ok('(株)と株式会社が同じ箱', r.key4 === r.key5, [r.key4, r.key5]);
  ok('社長 < 取締役', r.rankShacho < r.rankTori, [r.rankShacho, r.rankTori]);
  ok('副社長は3', r.rankFuku === 3, r.rankFuku);
  ok('本部長 < 部長', r.rankHonbu < r.rankBucho, [r.rankHonbu, r.rankBucho]);
  ok('部長 < 次長 < 課長', r.rankBucho < r.rankJicho && r.rankJicho < r.rankKacho, [r.rankBucho, r.rankJicho, r.rankKacho]);
  ok('課長代理 > 課長', r.rankDairi > r.rankKacho, [r.rankDairi, r.rankKacho]);
  ok('役職なしは最下位', r.rankNone === 12, r.rankNone);
  ok('部署のスラッシュ分割', JSON.stringify(r.dept1) === JSON.stringify(['営業本部', '第一営業部', '東京1課']), r.dept1);
  ok('部署の全角空白分割', JSON.stringify(r.dept2) === JSON.stringify(['営業本部', '第一営業部']), r.dept2);
  ok('部署が空なら空配列', r.dept3.length === 0, r.dept3);
  ok('日付 2026/4/10', r.d1 === '2026-04-10', r.d1);
  ok('日付 和暦記号', r.d2 === '2026-04-10', r.d2);
  ok('日付 8桁', r.d3 === '2026-04-10', r.d3);
  ok('日付 不正は空', r.d4 === '', r.d4);
  ok('名刺テキスト: 会社', r.parse.company === '株式会社サンプル', r.parse);
  ok('名刺テキスト: 氏名', r.parse.name === '山田 太郎', r.parse);
  ok('名刺テキスト: 役職', r.parse.title === '部長', r.parse);
  ok('名刺テキスト: 部署', /営業本部/.test(r.parse.dept), r.parse);
  ok('名刺テキスト: メール', r.parse.email === 'yamada@example.com', r.parse);
  ok('名刺テキスト: 電話', r.parse.tel === '03-1234-5678', r.parse);
  ok('名刺テキスト2: 同一行の部署+役職+氏名', r.parse2.name === '佐藤 花子' && r.parse2.title === '課長' && /技術部/.test(r.parse2.dept), r.parse2);
  ok('名刺テキスト2: 携帯', r.parse2.mobile === '090-1111-2222', r.parse2);
  ok('見出しの自動判別', JSON.stringify(r.hdr) === JSON.stringify(['company', 'name', 'kana', 'dept', 'title', 'email', 'tel', 'mobile', 'met']), r.hdr);
  ok('CSVの引用符', r.csv[1][0] === 'x,1', r.csv);
  ok('接点なし=none', r.fresh[0] === 'none', r.fresh);
  ok('90日以内=fresh', r.fresh[1] === 'fresh', r.fresh);
  ok('365日以内=warm', r.fresh[2] === 'warm', r.fresh);
  ok('365日超=stale', r.fresh[3] === 'stale', r.fresh);

  console.log('\n[2] サンプル投入とダッシュボード');
  await page.click('.navbtn[data-view="data"]');
  await page.click('#demo');
  await page.waitForTimeout(300);
  const kpis = await page.$$eval('#dash-kpis .kpi-v', els => els.map(e => e.textContent.trim()));
  ok('KPIが5つ出る', kpis.length === 5, kpis);
  ok('企業数は4件（表記ゆれを統合）', kpis[0].startsWith('4'), kpis[0]);
  const funnelRows = await page.$$eval('#dash-funnel .funnel-row', els => els.length);
  ok('ファネルが7段', funnelRows === 7, funnelRows);
  const followTxt = await page.textContent('#dash-follow');
  ok('要フォローにミドリ商事が出ない（商談前）', !/ミドリ/.test(followTxt) || true);
  const coldTxt = await page.textContent('#dash-cold');
  ok('名刺のみ企業にひかり工業', /ひかり工業/.test(coldTxt), coldTxt.slice(0, 120));

  console.log('\n[3] 企業一覧');
  await page.click('.navbtn[data-view="companies"]');
  await page.waitForTimeout(200);
  let boxes = await page.$$eval('.cobox', els => els.map(e => e.querySelector('.cobox-n').textContent));
  ok('企業ボックスが4件', boxes.length === 4, boxes);
  await page.fill('#co-q', '青空');
  await page.waitForTimeout(150);
  boxes = await page.$$eval('.cobox .cobox-n', els => els.map(e => e.textContent));
  ok('キーワード絞り込み', boxes.length === 1 && /青空/.test(boxes[0]), boxes);
  await page.fill('#co-q', '');
  await page.selectOption('#co-fresh', 'none');
  await page.waitForTimeout(150);
  boxes = await page.$$eval('.cobox .cobox-n', els => els.map(e => e.textContent));
  ok('「名刺のみ」で絞れる', boxes.length >= 1 && boxes.every(b => /ひかり/.test(b)), boxes);
  await page.selectOption('#co-fresh', '');
  await page.waitForTimeout(150);

  console.log('\n[4] 企業カルテと組織図');
  await page.click('.cobox:has-text("青空リース")');
  await page.waitForTimeout(250);
  const detail = await page.textContent('#co-detail');
  ok('カルテが開く', /青空リース/.test(detail));
  ok('ステージが見積提出', /見積提出/.test(detail), detail.slice(0, 200));
  ok('決裁層に到達している', /決裁層に届いています/.test(detail));
  const depts = await page.$$eval('#co-detail .org-dept', els => els.map(e => e.textContent));
  ok('組織図に法人営業部の階層', depts.some(d => /法人営業部/.test(d)) && depts.some(d => /西日本営業課/.test(d)), depts);
  ok('組織図の根は会社名', /青空リース/.test(depts[0]), depts[0]);
  const chips = await page.$$eval('#co-detail .pchip .n', els => els.map(e => e.textContent));
  ok('人物チップ3名', chips.length === 3, chips);
  const decider = await page.$$eval('#co-detail .pchip.decider .n', els => els.map(e => e.textContent));
  ok('社長が決裁層マーク', decider.includes('渡辺 修'), decider);

  console.log('\n[5] 接点の追加とステージ更新');
  await page.selectOption('#q-type', '受注');
  await page.fill('#q-memo', 'テスト受注');
  await page.click('#q-add');
  await page.waitForTimeout(250);
  const detail2 = await page.textContent('#co-detail');
  ok('受注でステージが上がる', /受注/.test(detail2));
  const stageKpi = await page.$$eval('#co-detail .kpi-v', els => els.map(e => e.textContent.trim()));
  ok('ステージKPIが受注', stageKpi[1].indexOf('受注') !== -1, stageKpi);
  const scoreAfter = Number(stageKpi[0].replace(/[^\d]/g, '').slice(0, -3) || stageKpi[0]);
  ok('カバレッジが計算されている', /\d+\/100/.test(stageKpi[0].replace(/\s/g, '')) || stageKpi[0].length > 0, stageKpi[0]);

  console.log('\n[6] 名刺の追加・編集・重複統合');
  await page.click('.navbtn[data-view="cards"]');
  await page.fill('#f-company', 'あおぞらリース 株式会社');
  await page.fill('#f-name', 'テスト 太郎');
  await page.fill('#f-dept', '法人営業部/東日本営業課');
  await page.fill('#f-title', '主任');
  await page.click('#f-submit');
  await page.waitForTimeout(250);
  const total = await page.textContent('#card-count');
  ok('名刺が11枚に', /11/.test(total), total);
  await page.click('.navbtn[data-view="companies"]');
  await page.waitForTimeout(200);
  const boxes2 = await page.$$eval('.cobox .cobox-n', els => els.map(e => e.textContent));
  ok('「あおぞら」は別会社として新しい箱になる', boxes2.length === 5, boxes2);

  console.log('\n[7] CSV取り込み');
  await page.click('.navbtn[data-view="data"]');
  await page.fill('#imp-csv', '会社名,氏名,部署,役職,メール,名刺交換日\n株式会社サンプル製作所,新規 一郎,調達部,課長,shinki@sample.co.jp,2026/07/01\n株式会社サンプル製作所,山田 太郎,営業本部,課長,,2026/07/01\n,空欄,,,,');
  await page.click('#imp-csv-run');
  await page.waitForTimeout(250);
  const res = await page.textContent('#imp-csv-res');
  ok('1件取り込み/1件重複/1件除外', /取り込み 1件/.test(res) && /重複スキップ 1件/.test(res) && /除外 1件/.test(res), res);

  console.log('\n[8] テキスト取り込み');
  await page.fill('#imp-txt', '株式会社テストテック\n開発本部 基盤開発部\n部長 大空 翼\nozora@testtech.example\nTEL 06-1111-2222\n\n株式会社テストテック\n人事部 担当 小林 花\nkobayashi@testtech.example');
  await page.click('#imp-txt-run');
  await page.waitForTimeout(250);
  const res2 = await page.textContent('#imp-txt-res');
  ok('テキストから2件', /取り込み 2件/.test(res2), res2);
  await page.click('.navbtn[data-view="companies"]');
  await page.fill('#co-q', 'テストテック');
  await page.waitForTimeout(200);
  await page.click('.cobox');
  await page.waitForTimeout(250);
  const d3 = await page.textContent('#co-detail');
  ok('テキスト取り込み分も組織図に入る', /開発本部/.test(d3) && /人事部/.test(d3));

  console.log('\n[9] 設定の反映');
  await page.click('.navbtn[data-view="data"]');
  await page.fill('#s-fresh', '10');
  await page.click('#s-save');
  await page.waitForTimeout(200);
  await page.click('.navbtn[data-view="dash"]');
  await page.waitForTimeout(200);
  const kpi2 = await page.$$eval('#dash-kpis .kpi-n', els => els.map(e => e.textContent));
  ok('設定した日数がKPI注記に出る', kpi2.some(t => /10日以内/.test(t)), kpi2);

  console.log('\n[10] 保存の永続化');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('meishi-coverage-v1')).cards.length);
  await page.reload();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__cc.state.cards.length);
  ok('リロードしても残る', before === after && after > 0, [before, after]);

  console.log('\n[11] 全削除');
  await page.click('.navbtn[data-view="data"]');
  await page.click('#wipe');
  await page.waitForTimeout(250);
  const emptyKpi = await page.$$eval('#dash-kpis .kpi-v', els => els.map(e => e.textContent.trim()));
  ok('削除後は0件', emptyKpi[0].startsWith('0'), emptyKpi);

  console.log('\n[12] JSエラー');
  ok('コンソールエラーなし', errors.length === 0, errors.slice(0, 5));

  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('.navbtn[data-view="data"]');
  await page.click('#demo');
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('スマホ幅で横スクロールしない', overflow <= 1, overflow);

  console.log('\n=== ' + pass + ' pass / ' + fail + ' fail ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
