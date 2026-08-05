#!/usr/bin/env node
/* Claude Code のフックから呼ばれて、出来事を1行ずつ events.jsonl に書き足すだけの記録係。
   モデルは一切呼ばないので、これ自体には料金が発生しない。
   Node は Claude Code の動作条件なので、必ず入っている。 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ev  = process.argv[2] || 'unknown';
const dir = process.env.AI_SHAIN_DIR || path.join(os.homedir(), '.claude', 'ai-shain');
const out = path.join(dir, 'events.jsonl');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  let d = {};
  try { d = JSON.parse(raw || '{}'); } catch { /* 壊れていても記録は続ける */ }

  /* フックが渡してくる項目名は種類ごとに違うので、ありそうな順に拾う */
  const pick = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), d);
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  };

  const line = {
    t: Date.now(),
    ev,
    agent: pick('agent_type', 'subagent_type', 'agent_name', 'agent',
                'tool_input.subagent_type', 'tool_input.agent_type'),
    desc:  pick('description', 'tool_input.description', 'prompt',
                'tool_input.prompt', 'message'),
    tool:  pick('tool_name'),
    session: pick('session_id'),
  };

  /* AI_SHAIN_DEBUG=1 を付けると、フックが実際に渡してくる中身がそのまま残る。
     項目名が合わないときはこれで確かめて、上の pick を直す。 */
  if (process.env.AI_SHAIN_DEBUG) line.raw = d;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(out, JSON.stringify(line) + '\n');
  } catch { /* 書けなくても Claude Code の邪魔はしない */ }
});
