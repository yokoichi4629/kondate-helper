# 献立ヘルパー — Claude向けメモ

再開時はまず `docs/PROGRESS.md`(開発記録)を読み、現状と次の候補を把握してから進めること。
設計書: https://claude.ai/artifact/6vAKNywZnUuTQv1tj5Z6YK

## 進め方
- ユーザーとのやりとり・画面の文言はすべて日本語。ユーザーはプログラミングに詳しくないので、専門用語は避けて説明する。
- English Master(`../English-Master`)と同じ構成。Cloudflare Workers の無料枠で動かす。
- リリースごとに `public/app.js` の `APP_VERSION` を上げ、`docs/PROGRESS.md` の更新履歴も追記する。

## 構成の要点
- フレームワークなしの素の HTML/CSS/JS(`public/`)+ Worker(`src/index.js`)。ビルド工程なし。
- 日数の計算は `public/calc.js` が設計書4章のルールどおりに行う。AIには「写真の読み取り」(`/api/scan`)と「1日分の献立」(`/api/menu`)だけを任せる。
- 献立は主菜・副菜の2品(汁物・主食なし。設計書から変更)。ジャンルは `Calc.genreFor` が和・洋・和・中の順で決める(和50%・洋25%・中25%)。
- AI: Workers AI の Gemma 4(`@cf/google/gemma-4-26b-a4b-it`、写真も読める)。
- 記録は端末の localStorage(キー `kondate-helper.v1`)。写真は保存しない。
- アレルギー・苦手な食材は `Calc.findAvoided` でアプリ側でも確認する(AIだけに頼らない)。

## 確認のしかた
- 本物の `src/index.js` を Node で読み込み、AIだけ模擬の返事にした小さなサーバーで画面を確認する(ポート8788、スマホ幅375px)。
- 計算: `public/calc.js` を `.cjs` にコピーして Node で `Calc.plan()` を呼ぶ。
