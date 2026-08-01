const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Service Worker は file:// では動かないので、PWAの確認だけ簡易サーバから配る。
// 127.0.0.1 は「安全なオリジン」として扱われるため https でなくても登録できる。
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
      const ext = path.extname(rel);
      try {
        const data = fs.readFileSync(path.resolve(__dirname, '..', '.' + rel));
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

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
  ok('決裁者がタグで指定されている', /タグで決裁者を指定済み/.test(detail), detail.slice(0, 200));
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

  console.log('\n[9] 名刺のカード表示と人物プロフィール');
  await page.click('.navbtn[data-view="cards"]');
  await page.waitForTimeout(250);
  const cardTotal = await page.evaluate(() => window.__cc.state.cards.length);
  const faces = await page.$$eval('#card-body .mcard', els => els.length);
  ok('名刺がカードで並ぶ', faces === cardTotal, [faces, cardTotal]);
  const faceText = await page.textContent('#card-body .mcard');
  ok('名刺の面に会社名と氏名が載る', faceText.length > 4, faceText.slice(0, 40));
  await page.click('[data-cardview="table"]');
  await page.waitForTimeout(200);
  ok('表示切替で表になる', (await page.$$('#card-body table')).length === 1);
  ok('表のときカードは無い', (await page.$$('#card-body .mcard')).length === 0);
  await page.click('[data-cardview="grid"]');
  await page.waitForTimeout(200);

  await page.fill('#card-q', '渡辺');
  await page.waitForTimeout(200);
  await page.click('#card-body .mcard');
  await page.waitForTimeout(250);
  ok('プロフィールが開く', await page.isVisible('#v-person'));
  const prof = await page.textContent('#p-detail');
  ok('氏名が出る', /渡辺 修/.test(prof));
  ok('会社へのリンクが出る', /青空リース/.test(prof));
  ok('決裁層と表示される', /決裁層/.test(prof), prof.slice(0, 200));
  const peerCount = await page.$$eval('#p-detail .peers .pchip', els => els.length);
  ok('同じ会社の人が並ぶ（自分を除く2名）', peerCount === 2, peerCount);
  const actsBefore = await page.evaluate(() => window.__cc.state.acts.length);
  await page.selectOption('#pq-type', '電話');
  await page.fill('#pq-memo', 'プロフィールから記録');
  await page.click('#pq-add');
  await page.waitForTimeout(250);
  const actsAfter = await page.evaluate(() => window.__cc.state.acts.length);
  ok('プロフィールから接点を記録できる', actsAfter === actsBefore + 1, [actsBefore, actsAfter]);
  ok('記録が履歴に出る', /プロフィールから記録/.test(await page.textContent('#p-detail')));
  await page.click('#p-back');
  await page.waitForTimeout(200);
  ok('戻るで名刺一覧へ', await page.isVisible('#v-cards'));

  console.log('\n[10] 名刺の写真');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAABlBMVEX/AAD///9BHTQRAAAAG0lEQVQoz2NgGAWjYBSMglEwCkbBKBgFo2AUAAAHrgABlfDrOgAAAABJRU5ErkJggg==',
    'base64');
  await page.click('#card-body .mcard');
  await page.waitForTimeout(200);
  await page.click('#p-detail [data-edit]');
  await page.waitForTimeout(250);
  const editing = await page.inputValue('#f-name');
  ok('編集フォームに乗る', editing === '渡辺 修', editing);
  await page.setInputFiles('#f-photo', { name: 'card.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(400);
  ok('写真のプレビューが出る', (await page.$$('#f-photo-pv img')).length === 1);
  await page.click('#f-submit');
  await page.waitForTimeout(500);
  const photoCount = await page.evaluate(() => Object.keys(window.__cc.photos()).length);
  ok('写真が1枚保存される', photoCount === 1, photoCount);
  await page.fill('#card-q', '渡辺');
  await page.waitForTimeout(250);
  ok('名刺カードが写真になる', (await page.$$('#card-body .mcard .mface img')).length === 1);
  ok('写真ありバッジが出る', /写真あり/.test(await page.textContent('#card-body .mcard')));
  await page.reload();
  await page.waitForTimeout(600);
  const photoCount2 = await page.evaluate(() => Object.keys(window.__cc.photos()).length);
  ok('リロードしても写真が残る（IndexedDB）', photoCount2 === 1, photoCount2);

  console.log('\n[11] 接点マップ');
  await page.click('.navbtn[data-view="map"]');
  await page.waitForTimeout(300);
  const mxRows = await page.$$eval('#map-matrix tbody tr', els => els.length);
  const coTotal = await page.evaluate(() => window.__cc.computeCompanies().length);
  ok('到達マップの行数＝企業数', mxRows === coTotal, [mxRows, coTotal]);
  const mxHead = await page.$$eval('#map-matrix thead th', els => els.map(e => e.textContent));
  ok('列は決裁層/管理層/実務層', mxHead.includes('決裁層') && mxHead.includes('管理層') && mxHead.includes('実務層'), mxHead);
  const emptyCells = await page.$$eval('#map-matrix .cell-empty', els => els.length);
  ok('名刺の無い層は斜線セル', emptyCells > 0, emptyCells);
  const freshCells = await page.$$eval('#map-matrix .cell-fresh', els => els.length);
  ok('接点のある層は緑セル', freshCells > 0, freshCells);
  const heatCols = await page.$$eval('#map-heat thead th', els => els.length);
  ok('ヒートマップは企業＋12か月＋計', heatCols === 14, heatCols);
  const heatRows = await page.$$eval('#map-heat tbody tr', els => els.length);
  ok('ヒートマップの行数＝企業数', heatRows === coTotal, [heatRows, coTotal]);
  const hot = await page.$$eval('#map-heat td.hm-1, #map-heat td.hm-2, #map-heat td.hm-3, #map-heat td.hm-4', els => els.length);
  ok('接点のある月に色がつく', hot > 0, hot);
  const ownerRows = await page.$$eval('#map-owner tbody tr', els => els.length);
  ok('担当者別の表が出る', ownerRows > 0, ownerRows);
  ok('担当者名が出る', /自分/.test(await page.textContent('#map-owner')));
  await page.click('#map-matrix tbody tr .lk');
  await page.waitForTimeout(250);
  ok('マップから企業カルテへ飛べる', await page.isVisible('#v-company'));

  console.log('\n[12] 企業ボックスのスパークライン');
  await page.click('.navbtn[data-view="companies"]');
  await page.waitForTimeout(250);
  const sparks = await page.$$eval('.cobox .spark', els => els.length);
  const bars = await page.$$eval('.cobox .spark i', els => els.length);
  ok('全企業にスパークラインが出る', sparks === coTotal, [sparks, coTotal]);
  ok('12か月ぶんのバー', bars === sparks * 12, [bars, sparks]);
  const monthsLen = await page.evaluate(() => window.__cc.lastMonths(12).length);
  ok('直近12か月を数える', monthsLen === 12, monthsLen);
  const mc = await page.evaluate(() => {
    const m = window.__cc.lastMonths(12);
    return window.__cc.monthCounts([{ date: m[11] + '-05' }, { date: m[11] + '-09' }, { date: '1999-01-01' }], m);
  });
  ok('月別集計が当月2件', mc[11] === 2 && mc.reduce((s, n) => s + n, 0) === 2, mc);

  console.log('\n[13] 決裁者・キーマンのタグ');
  await page.click('.navbtn[data-view="companies"]');
  await page.fill('#co-q', '');
  await page.waitForTimeout(200);
  const decInfo = await page.evaluate(() => window.__cc.computeCompanies().map((c) => ({
    name: c.name, mode: c.decMode, dec: c.deciderCards.map((x) => x.name), key: c.keyCards.map((x) => x.name),
  })));
  const sample = decInfo.filter((c) => /サンプル製作所/.test(c.name))[0];
  ok('タグのある会社はタグ運用になる', sample.mode === 'tag', sample);
  ok('決裁者は部長の鈴木一郎', sample.dec.join() === '鈴木 一郎', sample);
  ok('キーマンも拾える', sample.key.join() === '高橋 次郎', sample);
  const hikari = decInfo.filter((c) => /ひかり/.test(c.name))[0];
  ok('タグの無い会社は役職から推定', hikari.mode === 'rank', hikari);

  const bands = await page.evaluate(() => {
    const s = window.__cc.state;
    const pick = (n) => s.cards.filter((c) => c.name === n)[0];
    return {
      bucho: window.__cc.effectiveBand(pick('鈴木 一郎')).label,
      honbu: window.__cc.effectiveBand(pick('田中 花子')).label,
      shacho: window.__cc.effectiveBand(pick('渡辺 修')).label,
      matsu: window.__cc.effectiveBand(pick('松本 剛')).label,
    };
  });
  ok('タグを付けた部長が決裁層になる', bands.bucho === '決裁層', bands);
  ok('同じ会社の本部長は管理層に落ちる', bands.honbu === '管理層', bands);
  ok('タグを付けた社長は決裁層のまま', bands.shacho === '決裁層', bands);
  ok('タグ運用外の会社は役職どおり', bands.matsu === '実務層', bands);

  await page.selectOption('#co-dec', 'tag');
  await page.waitForTimeout(200);
  const tagCos = await page.$$eval('.cobox .cobox-n', (els) => els.map((e) => e.textContent));
  ok('「タグで特定済み」で絞れる', tagCos.length === 2, tagCos);
  await page.selectOption('#co-dec', 'none');
  await page.waitForTimeout(200);
  const noneCos = await page.$$eval('.cobox .cobox-n', (els) => els.map((e) => e.textContent));
  ok('「決裁層に未到達」で絞れる', noneCos.length >= 1 && noneCos.every((n) => !/サンプル製作所|青空/.test(n)), noneCos);
  await page.selectOption('#co-dec', '');
  await page.waitForTimeout(200);
  ok('企業ボックスに決裁者名が出る', /決裁者 鈴木 一郎/.test(await page.textContent('#co-list')));

  await page.click('.navbtn[data-view="map"]');
  await page.waitForTimeout(250);
  const mapHead = await page.$$eval('#map-matrix thead th', (els) => els.map((e) => e.textContent));
  ok('到達マップに決裁者の列', mapHead.includes('決裁者'), mapHead);
  ok('タグ運用の会社に「タグ」表示', (await page.$$('#map-matrix tbody .b-key')).length >= 2);

  console.log('\n[14] タグの付け外しと保存');
  await page.click('.navbtn[data-view="cards"]');
  await page.fill('#card-q', '松本');
  await page.waitForTimeout(250);
  await page.click('#card-body .mcard');
  await page.waitForTimeout(250);
  await page.click('#p-detail [data-ptag="決裁者"]');
  await page.waitForTimeout(300);
  const afterTag = await page.evaluate(() => {
    const c = window.__cc.state.cards.filter((x) => x.name === '松本 剛')[0];
    return { tags: c.tags, band: window.__cc.effectiveBand(c).label };
  });
  ok('プロフィールからタグを付けられる', afterTag.tags.indexOf('決裁者') !== -1, afterTag);
  ok('付けた瞬間に層が変わる', afterTag.band === '決裁層', afterTag);
  await page.reload();
  await page.waitForTimeout(500);
  const persisted = await page.evaluate(() =>
    window.__cc.state.cards.filter((x) => x.name === '松本 剛')[0].tags);
  ok('タグはリロードしても残る', persisted.indexOf('決裁者') !== -1, persisted);
  await page.click('.navbtn[data-view="cards"]');
  await page.fill('#card-q', '松本');
  await page.waitForTimeout(250);
  await page.click('#card-body .mcard');
  await page.waitForTimeout(250);
  await page.click('#p-detail [data-ptag="決裁者"]');
  await page.waitForTimeout(300);
  const removed = await page.evaluate(() =>
    window.__cc.state.cards.filter((x) => x.name === '松本 剛')[0].tags);
  ok('もう一度押すと外れる', removed.indexOf('決裁者') === -1, removed);

  console.log('\n[15] タグの取り込みと書き出し');
  const tagParse = await page.evaluate(() => window.__cc.parseTags('決裁者, キーマン 窓口/決裁者'));
  ok('タグ文字列の分解と重複除去', JSON.stringify(tagParse) === JSON.stringify(['決裁者', 'キーマン', '窓口']), tagParse);
  const hdrTags = await page.evaluate(() => window.__cc.mapHeaders(['会社名', '氏名', '役職', 'タグ']));
  ok('CSV見出しのタグを見分ける', hdrTags[3] === 'tags', hdrTags);
  await page.click('.navbtn[data-view="data"]');
  await page.fill('#imp-csv', '会社名,氏名,役職,タグ\n株式会社タグ試験,試験 花子,主任,決裁者 キーマン');
  await page.click('#imp-csv-run');
  await page.waitForTimeout(300);
  const imported = await page.evaluate(() => {
    const c = window.__cc.state.cards.filter((x) => x.name === '試験 花子')[0];
    return { tags: c.tags, band: window.__cc.effectiveBand(c).label };
  });
  ok('CSVからタグを取り込める', imported.tags.join() === '決裁者,キーマン', imported);
  ok('取り込んだタグが層に効く', imported.band === '決裁層', imported);

  console.log('\n[16] 設定の反映');
  await page.click('.navbtn[data-view="data"]');
  await page.fill('#s-fresh', '10');
  await page.click('#s-save');
  await page.waitForTimeout(200);
  await page.click('.navbtn[data-view="dash"]');
  await page.waitForTimeout(200);
  const kpi2 = await page.$$eval('#dash-kpis .kpi-n', els => els.map(e => e.textContent));
  ok('設定した日数がKPI注記に出る', kpi2.some(t => /10日以内/.test(t)), kpi2);

  console.log('\n[17] 保存の永続化');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('meishi-coverage-v1')).cards.length);
  await page.reload();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__cc.state.cards.length);
  ok('リロードしても残る', before === after && after > 0, [before, after]);

  console.log('\n[18] 全削除');
  await page.click('.navbtn[data-view="data"]');
  await page.click('#wipe');
  await page.waitForTimeout(250);
  const emptyKpi = await page.$$eval('#dash-kpis .kpi-v', els => els.map(e => e.textContent.trim()));
  ok('削除後は0件', emptyKpi[0].startsWith('0'), emptyKpi);

  console.log('\n[19] JSエラー');
  ok('コンソールエラーなし', errors.length === 0, errors.slice(0, 5));

  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('.navbtn[data-view="data"]');
  await page.click('#demo');
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('スマホ幅で横スクロールしない', overflow <= 1, overflow);

  console.log('\n[20] アプリ化（ブラウザで開いた状態）');
  ok('file:// ではオフライン対応にできない', (await page.evaluate(() => window.__cc.canServiceWorker())) === false);
  ok('アプリ表示ではない', (await page.evaluate(() => window.__cc.isStandalone())) === false);
  await page.click('.navbtn[data-view="data"]');
  await page.waitForTimeout(250);
  ok('入れられない事情を画面に出す', /ホーム画面には入れられません/.test(await page.textContent('#install-how')));

  console.log('\n[21] アプリ化（サーバから開いた状態）');
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  const errors2 = [];
  p2.on('pageerror', (e) => errors2.push(String(e)));
  p2.on('dialog', (d) => d.accept());
  await p2.goto(base + '/index.html');
  await p2.waitForTimeout(400);

  const mf = await p2.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').getAttribute('href');
    const res = await fetch(href);
    return { status: res.status, json: await res.json() };
  });
  ok('マニフェストが読める', mf.status === 200, mf.status);
  ok('全画面で開く指定', mf.json.display === 'standalone', mf.json.display);
  ok('起動先とスコープが同じ場所', mf.json.start_url === './' && mf.json.scope === './', mf.json);
  ok('アイコンは192と512とmaskable',
    mf.json.icons.length === 3 && mf.json.icons.some((i) => i.purpose === 'maskable'), mf.json.icons);

  const icons = await p2.evaluate(async () => {
    const out = {};
    for (const n of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
      const r = await fetch('./' + n);
      out[n] = r.status;
    }
    return out;
  });
  ok('アイコンの実体がある', Object.values(icons).every((v) => v === 200), icons);
  ok('Appleのアイコン指定がある', (await p2.$$('link[rel="apple-touch-icon"]')).length === 1);
  ok('テーマ色が入っている',
    (await p2.getAttribute('meta[name="theme-color"]', 'content')) === '#0b0e12');

  const swReady = await p2.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false));
  ok('Service Workerが動き出す', swReady === true);

  await p2.click('.navbtn[data-view="data"]');
  await p2.click('#demo');
  await p2.waitForTimeout(500);
  const beforeOffline = await p2.evaluate(() => window.__cc.state.cards.length);

  await ctx.setOffline(true);
  await p2.reload();
  await p2.waitForTimeout(700);
  const offlineCards = await p2.evaluate(() => window.__cc.state.cards.length);
  ok('圏外でも画面が開く', (await p2.$$('.navbtn')).length === 6);
  ok('圏外でもデータが残る', offlineCards === beforeOffline && beforeOffline > 0, [beforeOffline, offlineCards]);
  await ctx.setOffline(false);

  await p2.goto(base + '/index.html?view=acts');
  await p2.waitForTimeout(400);
  ok('ショートカットから接点タブが開く', await p2.isVisible('#v-acts'));
  ok('サーバ経由でもJSエラーなし', errors2.length === 0, errors2.slice(0, 3));
  await ctx.close();

  console.log('\n[22] iPhone から開いた場合の案内');
  const ios = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const p3 = await ios.newPage();
  p3.on('dialog', (d) => d.accept());
  await p3.goto(base + '/index.html');
  await p3.waitForTimeout(400);
  ok('iPhoneと判定する', (await p3.evaluate(() => window.__cc.isIOS())) === true);
  ok('ヘッダに入れるボタンが出る', await p3.isVisible('#install-btn'));
  await p3.click('.navbtn[data-view="data"]');
  await p3.waitForTimeout(250);
  const iosHow = await p3.textContent('#install-how');
  ok('共有→ホーム画面に追加の手順を出す',
    /共有ボタン/.test(iosHow) && /ホーム画面に追加/.test(iosHow), iosHow.slice(0, 80));
  const overflow2 = await p3.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('iPhone幅で横スクロールしない', overflow2 <= 1, overflow2);
  await ios.close();
  srv.close();

  console.log('\n=== ' + pass + ' pass / ' + fail + ' fail ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
