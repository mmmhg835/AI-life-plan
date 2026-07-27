/* AI診断の中継。
   クライアントからは数値・真偽値のみを受け取り、プロンプトはこのファイル内で組み立てる。
   文字列を一切そのまま渡さないことで、任意プロンプトの実行（＝APIキーの踏み台化）を防ぐ。 */

const RATE_MAX = num(process.env.AI_RATE_MAX, 1, 1000, 20);          /* 同一IPの上限回数 */
const RATE_WINDOW_MS = num(process.env.AI_RATE_WINDOW_MIN, 1, 1440, 60) * 60000;
const RATE_MAX_KEYS = 5000;                                          /* メモリ上限 */

/* 同一インスタンス内のカウンタ。サーバーレスなので完全ではないが、
   単一クライアントからの連打・スクリプト叩きはこれで止まる。 */
const hits = new Map();

function num(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > RATE_MAX_KEYS) hits.clear();
  const cur = hits.get(ip);
  if (!cur || now - cur.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
    return false;
  }
  cur.n += 1;
  return cur.n > RATE_MAX;
}

function hostOf(u) {
  try { return new URL(u).host; } catch { return ''; }
}

/* 自分のドメインから開かれたページ以外は弾く。
   ブラウザは同一オリジンのPOSTにもOriginを付けるので、curl等はここで落ちる。 */
function originAllowed(req) {
  const self = req.headers.host || '';
  const extra = (process.env.ALLOWED_ORIGIN_HOSTS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const src = hostOf(req.headers.origin) || hostOf(req.headers.referer);
  if (!src) return false;
  return src === self || extra.includes(src);
}

/* 受け取ったJSONを数値・真偽値だけに正規化する。想定外の値は既定値に丸める。 */
function sanitize(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const dep = b.depletionAge;
  return {
    age: num(b.age, 0, 120, 30),
    retireAge: num(b.retireAge, 0, 120, 65),
    endAge: num(b.endAge, 0, 120, 95),
    netMonthly: num(b.netMonthly, 0, 9999, 0),
    hasPartner: b.hasPartner === true,
    kidCount: num(b.kidCount, 0, 20, 0),
    eduTotal: num(b.eduTotal, 0, 999999, 0),
    buyHouse: b.buyHouse === true,
    housePrice: num(b.housePrice, 0, 999999, 0),
    carCount: num(b.carCount, 0, 50, 0),
    retireAssets: num(b.retireAssets, -9999999, 9999999, 0),
    totalAssets: num(b.totalAssets, -9999999, 9999999, 0),
    pensionMonthly: num(b.pensionMonthly, 0, 9999, 0),
    severanceNet: num(b.severanceNet, 0, 999999, 0),
    withdrawTotal: num(b.withdrawTotal, 0, 9999999, 0),
    depletionAge: dep == null ? null : num(dep, 0, 120, 0)
  };
}

function buildPrompt(d) {
  const housing = d.buyHouse ? `${d.housePrice}万購入予定` : '賃貸';
  const depletion = d.depletionAge == null ? 'なし' : `${d.depletionAge}歳`;
  return `FPとして診断。出力は有効なJSON1つのみ（前後に説明・\`\`\`禁止）。
データ: ${d.age}歳/退職${d.retireAge}歳/${d.endAge}歳まで試算/月手取${d.netMonthly}万/配偶${d.hasPartner ? '有' : '無'}/子${d.kidCount}人/教育費総額${d.eduTotal}万/住宅${housing}/車${d.carCount}台計画/退職時資産${d.retireAssets}万/最終${d.totalAssets}万/年金手取月${d.pensionMonthly}万/退職金手取${d.severanceNet}万/老後取り崩し総額${d.withdrawTotal}万/資産枯渇${depletion}
必須キーと制限: score 0-100整数, scoreComment 12字以内, overview 1文45字以内, strengths 文字列3つ各22字以内, risks 2つ各28字以内, actions 3つ各22字以内, fireStatus 1文40字以内
例: {"score":65,"scoreComment":"バランス型","overview":"...","strengths":["","",""],"risks":["",""],"actions":["","",""],"fireStatus":"..."}`;
}

function validReport(r) {
  const strs = a => Array.isArray(a) && a.every(s => typeof s === 'string');
  return r && typeof r === 'object'
    && Number.isFinite(Number(r.score))
    && typeof r.scoreComment === 'string' && typeof r.overview === 'string'
    && strs(r.strengths) && r.strengths.length >= 1
    && strs(r.risks) && r.risks.length >= 1
    && strs(r.actions) && r.actions.length >= 1
    && typeof r.fireStatus === 'string';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (rateLimited(clientIp(req))) {
    res.setHeader('Retry-After', String(Math.ceil(RATE_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'Too many requests' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return res.status(503).json({ error: 'AI service unavailable' });
  }

  const prompt = buildPrompt(sanitize(req.body));

  const upstream = new AbortController();
  const upTimer = setTimeout(() => upstream.abort(), 22000);
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: upstream.signal
    });

    if (!anthropicRes.ok) {
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await anthropicRes.json();
    const text = (data.content || []).map(c => c.text || '').join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!validReport(parsed)) {
      return res.status(502).json({ error: 'AI service error' });
    }
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: 'AI report generation failed' });
  } finally {
    clearTimeout(upTimer);
  }
}
