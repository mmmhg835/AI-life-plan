# 実況をつなぐ

Claude Code が動いた出来事を町に流し込みます。**追加料金はかかりません。**
使うのはフック（設定した条件でコマンドを実行する仕組み）だけで、モデルを呼ばないからです。

## 入れ方

**1. 記録係を置く**

```sh
mkdir -p ~/.claude/ai-shain
cp ai-shain/live/record.mjs ~/.claude/ai-shain/
```

**2. `~/.claude/settings.json` にフックを足す**

`ai-shain/live/settings.snippet.json` の中身を混ぜます。
**すでに `hooks` がある場合は、消さずに中身を足してください。** 丸ごと置き換えると既存のフックが消えます。

**3. 反映する**

Claude Code で `/hooks` を一度開くか、再起動します。設定ファイルを書いただけでは読み込まれないことがあります。

**4. 町を開く**

`index.html` の隣に `events.jsonl` が要ります。記録係の出力先を町の横に置くのが簡単です。

```sh
cd ai-shain
ln -s ~/.claude/ai-shain/events.jsonl events.jsonl
python3 -m http.server 8899
```

`http://localhost:8899/` を開いて、右下が **● LIVE** になれば通っています。
ファイルをそのままダブルクリックで開くと、ブラウザの制約で `events.jsonl` が読めません。サーバー経由で開いてください（ただのファイル配信なので無料です）。

## 動きの対応

| フック | 町 |
|---|---|
| `SessionStart` | 朝礼 |
| `UserPromptSubmit` | 社長からの指示として日報に載る |
| `SubagentStart` | 席が割り当てられて動き出す |
| `SubagentStop` | 完了して待機に戻る |
| `PostToolUse` | 頭上に、いま使っている道具の名前 |
| `Stop` / `SessionEnd` | 報告・終業 |

**席は先着順で自動的に割り当てられます。** 名簿にない名前のエージェントが来たら、空いている席に座ってその名前で表示されます。つまり `.claude/agents/` に何を定義しても、そのまま町に出ます。10席が埋まったら、手の空いた人と交代します。

## 項目名が合わないとき

社員が「担当」という名前ばかりになる場合、フックが渡してくる項目名が `record.mjs` の想定と違います。中身を確かめてください。

```sh
AI_SHAIN_DEBUG=1   # を settings.json の env に足すと raw が丸ごと残る
tail -n 5 ~/.claude/ai-shain/events.jsonl
```

`raw` の中の実際のキー名を見て、`record.mjs` の `pick(...)` に足します。

## 止め方・掃除

- 止める：`settings.json` の該当フックを消すか、`disableAllHooks: true`
- ログが伸びたら：`: > ~/.claude/ai-shain/events.jsonl`（町は自動で読み直します）

## かからない費用について

フックの種類は `command`（シェル実行）と `http`（POST）だけを使っています。
フックには `prompt` と `agent` という種類もありますが、**これらは中で Claude を呼ぶので課金対象です。使っていません。**
記録係がやっているのは JSON を1行書き足すことだけで、モデルは一切動きません。
