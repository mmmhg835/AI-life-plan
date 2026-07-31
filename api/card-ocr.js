/* 名刺画像の読み取り中継。
   クライアントからは画像1枚だけを受け取り、プロンプトはこのファイル内で組み立てる。
   文字列を一切そのまま渡さないことで、任意プロンプトの実行（＝APIキーの踏み台化）を防ぐ。

   この構成は api/ai-report.js に合わせてある（このリポジトリは依存パッケージを
   持たない静的サイトなので、SDKを足さずにfetchで直接叩いている）。 */

const RATE_MAX = num(process.env.OCR_RATE_MAX, 1, 1000, 60);          /* 同一IPの上限枚数 */
const RATE_WINDOW_MS = num(process.env.OCR_RATE_WINDOW_MIN, 1, 1440, 60) * 60000;
const RATE_MAX_KEYS = 5000;                                          /* メモリ上限 */
const MAX_IMAGE_CHARS = 2_000_000;                                   /* base64の長さ（約1.5MB） */

const MODEL = process.env.OCR_MODEL || 'claude-opus-5';
const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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

/* data URL から media_type と base64 本体だけを取り出す。それ以外は受け付けない。 */
function readImage(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  if (typeof b.image !== 'string') return { error: '画像がありません' };
  const m = b.image.match(/^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: '画像の形式が読めません' };
  if (!ALLOWED_MEDIA.includes(m[1])) return { error: '対応していない画像形式です' };
  if (m[2].length > MAX_IMAGE_CHARS) return { error: '画像が大きすぎます' };
  return { mediaType: m[1], data: m[2] };
}

const PROMPT = `この画像は日本のビジネス名刺です。書かれている内容をそのまま項目に書き写してください。

守ること:
- 画像に書かれていない項目は空文字にする。推測で埋めない。
- company は法人格（株式会社・有限会社など）も含めて名刺の表記のまま書く。
- dept に階層（本部・部・課など）が複数あるときは上位から / で区切る。例: 営業本部/第一営業部/東京1課
- title は役職だけ（部長、代表取締役社長 など）。部署名は入れない。
- kana は名刺にふりがな・ローマ字が書かれているときだけ入れる。
- tel は代表・直通の固定電話、mobile は携帯（070/080/090、または「携帯」「Mobile」と書かれた番号）。FAXは入れない。
- address は郵便番号を含む住所を1行にまとめる。
- 名刺ではない画像、または文字が読み取れない場合は、すべて空文字にする。`;

const SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    name: { type: 'string' },
    kana: { type: 'string' },
    dept: { type: 'string' },
    title: { type: 'string' },
    email: { type: 'string' },
    tel: { type: 'string' },
    mobile: { type: 'string' },
    address: { type: 'string' }
  },
  required: ['company', 'name', 'kana', 'dept', 'title', 'email', 'tel', 'mobile', 'address'],
  additionalProperties: false
};

const FIELDS = SCHEMA.required;

/* モデルの出力を素通しせず、想定した項目・長さだけに切り詰める。 */
function sanitizeCard(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const out = {};
  for (const f of FIELDS) {
    const v = parsed[f];
    out[f] = typeof v === 'string' ? v.trim().slice(0, 200) : '';
  }
  return out;
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
    return res.status(429).json({ error: '読み取りの上限に達しました。しばらく待ってからお試しください' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return res.status(503).json({ error: '読み取り機能が設定されていません' });
  }

  const img = readImage(req.body);
  if (img.error) {
    return res.status(400).json({ error: img.error });
  }

  const upstream = new AbortController();
  const upTimer = setTimeout(() => upstream.abort(), 45000);
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: SCHEMA }
        },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
            { type: 'text', text: PROMPT }
          ]
        }]
      }),
      signal: upstream.signal
    });

    if (!anthropicRes.ok) {
      return res.status(502).json({ error: '読み取りに失敗しました' });
    }

    const data = await anthropicRes.json();

    /* 安全側の判定に引っかかった場合は content が空になることがある */
    if (data.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'この画像は読み取れませんでした' });
    }

    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
    const card = sanitizeCard(JSON.parse(text));
    if (!card) {
      return res.status(502).json({ error: '読み取り結果を解釈できませんでした' });
    }
    if (!card.company && !card.name) {
      return res.status(422).json({ error: '名刺として読み取れませんでした' });
    }
    return res.status(200).json({ card });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return res.status(504).json({ error: '読み取りに時間がかかりすぎました' });
    }
    return res.status(500).json({ error: '読み取りに失敗しました' });
  } finally {
    clearTimeout(upTimer);
  }
}
