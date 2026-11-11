# new（勉強アプリのまとめ）

勉強時間・時間割・教材ノルマ・講座チェックリスト・過去問の得点・間違えた問題の受け箱を、1つにまとめた Web アプリ。
iPhone のホーム画面に追加して使う（GitHub Pages）。仕様は [SPEC.md](SPEC.md)。

- 今日：計る（時間割／普通に計る）、今日のコマ、今日のノルマ、講座の次の1本
- 送る：間違えた問題を study-inbox の `inbox/` に送る
- 記録：勉強時間（グラフ）、過去問、講座
- 設定：鍵、時間割、知らせ、教材ノルマ、目標と科目、過去問の配点

## 記録の置き場所

非公開リポジトリ study-inbox。前のアプリ（kirocker2・checkiiii・oresamatenbuyer・ukebakkow）と同じファイル・同じ形で保存するので、並べて使える。

| ファイル | 中身 |
|---|---|
| `records/study-log.json` | 勉強時間と教材ノルマ。時間割で「やった」にしたコマは `kind: "slot"` の記録として入る |
| `records/kouza.json` | 講座チェックリスト |
| `records/scores.json` | 過去問の得点 |
| `records/timetable.json` | 時間割と、コマに付けた印（このアプリだけが使う） |
| `inbox/<id>/` | 間違えた問題（写真と meta.json） |

## 作り

ビルドなし。`index.html` と `css/app.css`、`js/` の ES モジュールだけで動く。

- `js/util.js` `merge.js` `tt.js` `calc.js`：画面に触らない計算（日付は朝4時区切り、記録の合わせ方、時間割、ノルマ）
- `js/store.js`：端末（localStorage）と GitHub の同期
- `js/today.js` `send.js` `rec-*.js` `settings.js` `notify.js`：画面
- `data/kouza-data.js`：講座の一覧
- `sw.js`：画面を端末に保存する。ファイルを足したら `FILES` に足し、`CACHE` の番号を上げる

## 確かめ方

```
TZ=Asia/Tokyo node --test tests/*.test.mjs          # 計算と合わせ方
python3 -m http.server 8765 &                        # 画面（Chrome と playwright が要る）
TZ=Asia/Tokyo STUDY_INBOX=../study-inbox node tests/browser.mjs
```
