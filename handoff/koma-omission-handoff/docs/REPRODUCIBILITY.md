# 再現手順

ルートはREADMEのフォルダ。Python依存はrequirements.txtで固定。OSやCPU/ライブラリの数値差で再学習の木が変わる可能性があるため、モデルを正とする推論再現と、再学習の再現を別々に確認する。データ・ソース・配布モデルのSHA256はMANIFEST.sha256.json、元入力のSHA256はdata/prepared-original-697.jsonのinputFilesにある。

## 1. 元回答から697問を再構成

```bash
.venv/bin/python tools/reproduce.py prepare --output work/prepared
```

raw7本→明示除外3問→geometry/signature再計算→進入枝の検証・復元→元697問との完全一致→事例01の二値訂正。復元に用いる京都ネットワークと進入路台帳はsource/site/dataに同梱。外部OSMを再ダウンロードして変化した道路を使わない。出力は元/修正後の両方で、元ファイルを上書きしない。

## 2. 歴史的な固定予測の再集計

```bash
.venv/bin/python tools/reproduce.py recount --output work/recount
```

FN 4/4/1、FP 42/50/53をassertする。参照モデルは分割ごとに学習された旧Dモデル。models/corrected-candidateではない。

## 3. 修正前の8:2・5分割・内側3分割を再実行

```bash
.venv/bin/python tools/reproduce.py cv-original --output work/cv-original
```

experiments/original-697/fold-N/split.jsonのキーを使用する。ノードID・端点12m以内の連結成分が学習/テストにまたがらないことをassertする。seed42、RF200本、深さ5、葉の最低2、n_jobs1。A/B/C/Dの各段階を再学習し、旧results.jsonと予測CSVを比較できる。全データ固定モデルも別途出力する。入力ファイル記録の絶対/相対パスは環境により異なるため、モデル/分割/特徴量/予測値を比較する。

## 4. 回答修正後に新しく交差検証

```bash
.venv/bin/python tools/reproduce.py cv-corrected --output work/cv-corrected
```

これは新実験。分割は同じだが学習ラベルが変わるため、予測も再集計1.5%とは変わり得る。出力はA〜Dとルールの評価で、ハイブリッド条件自体の内側チューニングを自動実装したものではない。ハイブリッド閾値探索まで外側テストで最適化しない。

## 5. 同梱の修正後候補モデルを再学習

```bash
.venv/bin/python tools/train_candidate.py --output work/corrected-candidate
```

学習全697問の内側3分割（seed242）でDの倍率・単体閾値を選び、全体でfit。exportしたJSONとsklearnの予測一致をassertする。goldenは同梱候補モデルから固定しているので、結果に合わせてgoldenの期待値を書き換えない。

## 6. 移植後の一致検査

```bash
node --test tests/handoff.test.cjs source/tests/*.test.cjs
.venv/bin/python -m unittest discover -s source/tests -p 'test_*.py'
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

元ルール、CP/信号の扱い、反復復帰、端点表示、除外、モデル出力、グループ漏洩、goldenを検査。Pythonの移植テストは697問すべての旧OOF Dスコアを1e-12以内で確認する。相手のNext.jsアプリ全体は別途既存test/typecheck/buildと操作テストで確認する。
