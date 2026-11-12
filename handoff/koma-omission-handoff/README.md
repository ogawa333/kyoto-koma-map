# コマ地図省略システム 引き継ぎ一式

受領者のAIエージェントは、最初に **AGENTS.md → docs/INTEGRATION.md → docs/INPUT_CONTRACT.md** を読んでください。質問ペアの類似判定と、コース全体でどのコマを残すかの処理を両方収録しています。

このフォルダを丸ごと送れば引き継げます。元アプリ・相手アプリへの変更や公開は、このパッケージ作成では行っていません。APIキー、Google課金、外部AIサービスは不要です。Python依存の初回インストール以外、同梱データの推論・再現にはネット接続は不要です。

## 最短の実行方法

フォルダのルートへ移動してください。Python **3.12**、Node.js **24** で検証しています。

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python tools/verify_bundle.py
node --test tests/handoff.test.cjs source/tests/*.test.cjs
.venv/bin/python -m unittest discover -s source/tests -p 'test_*.py'
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python runtime/predict.py < example-pairs.json
```

Windowsでは `.venv/bin/python` を `.venv\Scripts\python.exe` に読み替えてください。JSはNode標準機能のみを使い、`npm install` は不要です。Pythonの推論に必要なのはnumpy/scipy、学習・完全テストにはscikit-learnも必要です。

回答修正後の前回の数値を再集計するには：

```bash
.venv/bin/python tools/reproduce.py recount --output work/recount
```

出力先は未作成のフォルダ名を指定します。`work` 自体は先に作成しなくて構いません。

## 何が入っているか

|場所|内容|
|---|---|
|`source/site/routing.js`|道なり判定・現行類似ルール・反復的なコマ復帰・再採番の元実装|
|`runtime/`|入力検査、特徴量生成、JSON森林モデル推論、ルール＋AIのコース選別用ラッパー|
|`integration/target-adapter.cjs`|指定先のGraph/JunctionCandidateから互換形状を作るアダプター例|
|`integration/target-reference/`|相手アプリを調べた時点の4ファイル。参照用で、これを上書きコピーしない|
|`models/reference-original-697.json`|回答修正前に697問全体で学習した旧固定モデル|
|`models/corrected-candidate/`|事例01を省略へ修正した697問で再学習した候補モデル・学習設定・内側分割|
|`data/raw/`|評価者P001の回答済み①〜⑦、合計700問の元エクスポート7本|
|`data/prepared-original-697.json`|3問を除外した修正前データ（保持68・省略629）|
|`data/prepared-corrected-697.json`|さらに事例01を修正した最新データ（保持67・省略630）|
|`experiments/original-697/`|歴史的な5分割の分割表、各分割Dモデル、予測CSV、設定、精度|
|`experiments/corrected-recount/`|今回の二値回答修正記録、予測を固定した再集計|
|`tests/golden.json`|12ペアの入力・350特徴量・候補モデル保持スコア。TypeScript移植の一致確認用|
|`tools/`|元データ再構成・再集計・交差検証・再学習・整合性検査|
|`PROVENANCE.json` / `MANIFEST.sha256.json`|出典コミット、対応先コミット、全配布ファイルのハッシュ|

## 今ある結果の意味

697問のうち残すべき67問に対する誤省略は、現行ルール4問（6.0%）、ルール・AIの両方が省略の場合だけ省略4問（6.0%）、追加保持条件1問（1.5%）。省略できる630問の不要保持はそれぞれ42・50・53問です。

**この1.5%は、旧モデルの外側テスト予測を固定して、回答1件を修正し、後から設計した組み合わせを当て直した参考値です。新しい候補モデルや相手アプリの達成精度ではありません。** 外側分割ごとにモデルが異なります。単一の全データ学習済みモデルでこの結果を再現するものでもありません。

修正済みデータで学習した候補モデルも同梱しましたが、独立評価前です。初期導入では `all` / `rule` を用意し、AIは `hybrid-experimental` として並行比較してください。詳しくは `docs/EVALUATION.md`。

## 相手のエージェントへ送る文章

`docs/AGENT_REQUEST.md` の文章と、このフォルダ全体を渡してください。ZIPを展開した後に、そこにあるREADMEとAGENTS.mdを読むよう依頼すれば引き継げます。
