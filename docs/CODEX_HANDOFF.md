# Codexでの作業再開

更新日：2026-11-13（日本時間）。この文書は、別のCodexセッションでもチャット履歴に依存せず、コマ地図省略システムの研究・開発・移植を続けるための引き継ぎ。

## 開始方法

GitHubリポジトリ：`ogawa333/kyoto-koma-map`。
移行用ブランチ：`docs/codex-junction-handoff`。
このブランチは`feat/junction-ai-ablation`の`cc6d9699a1d8df1ec42cd433ac40d8e016f70292`を基に作成。元の研究変更はPR #16（https://github.com/ogawa333/kyoto-koma-map/pull/16）。移行時点のmainは`ec56fe99b8e3c6f8297cda51448d60e858d9ad54`。マージ状態は今後変わり得るのでGitHubで再確認する。

新しいCodexでこのリポジトリと移行用ブランチを選び、次を指示する。

> AGENTS.mdとdocs/CODEX_HANDOFF.mdを読んで、現在の状態を確認してください。引き継ぎ一式はhandoff/koma-omission-handoffにあります。まず整合性チェックとテストを実行してください。その後は私の次の変更指示に従って作業してください。

mainが選択されて引き継ぎファイルが見つからない場合、ユーザーが指定した移行用ブランチをチェックアウトする。未コミット変更を消したり、他の作業ブランチを強制的に切り替えたりしない。

## これまでの目的と現在の状態

- 現行ルールは、全交差点から道なりで省略可能なものを選び、次の表示コマに似た省略交差点を復帰させる。区間が分かれたら繰り返し、最後に採番・距離・全体図を更新する。
- 道の本数と左右を重視する。形状が分からない場合や、CP/開始終了/折り返し/手動編集等は保持する。信号だけで残る直進コマは、コマ自体は残すが、手前の類似判定の比較先から外す。
- 評価者は1名P001。京都①〜③と三浦④〜⑦、合計700問。OSMの不適切形状として指定された3問を除外し697問にした。
- さらにユーザーが三浦④の問題42を「残す」から「省略してよい」へ訂正した。最新ラベルはkeep67、omit630。元のブラウザ回答やrawを訂正前のまま保存し、訂正を別記録している。
- AIは画像モデルではなく、道路形状350特徴量＋RandomForest。特徴量は枝の一対一対応、進入路、2/5/8/12/20mの曲がり、長さ・到達率・描画ずれ等を含む。
- 最新候補モデルは修正済み697問で再学習済みだが、独立テスト前。AI追加保持を本体サイトへ自動適用した状態ではない。
- 相手の`shotaciel5/MiuraWalkingRally`に渡す一式を作成済み。相手アプリへの実装・E2E検証・公開は未実施。

## リポジトリ内に移したもの

`handoff/koma-omission-handoff/`に次を同梱している。従来のダウンロード用ZIPと同じ内容で、チェックサムで確認可能。

|場所|役割|
|---|---|
|README.md / AGENTS.md|一式の読み方、実行方法、エージェント向け指示|
|data/raw/set-01.json〜set-07.json|訂正前の回答700問の元データ|
|data/prepared-original-697.json|除外3問後、keep68/omit629の旧データ|
|data/prepared-corrected-697.json|回答1問訂正後、keep67/omit630の最新学習データ|
|experiments/corrected-recount/label-correction.json|事例01の二値訂正の明示記録|
|models/corrected-candidate/model.json|最新ラベルから学習した候補の重み（JSON形式の森林）|
|models/reference-original-697.json|旧ラベルでの全697問学習モデル|
|experiments/original-697/fold-1〜5|当時の分割と各分割のDモデル、評価情報|
|runtime / source / tools / tests|判定、学習、再集計、再現、移植確認用コード|
|integration / docs/INTEGRATION.md|相手アプリ向けアダプター例と対応箇所|

一式の中にあるpackage.jsonやAGENTS.mdは、ルートの同名ファイルを置き換える目的ではない。外部アプリへ渡す場合も、フォルダごと隔離して取り込む。

## 最新の比較結果と注意

旧8:2・5分割の予測値を固定し、事例01の回答を訂正して再集計した結果：

|方法|誤省略（keep67問中）|不要保持（omit630問中）|
|---|---:|---:|
|現行ルール|4問（6.0%）|42問（6.7%）|
|ルール・AIが両方省略の場合だけ省略|4問（6.0%）|50問（7.9%）|
|現行ルールの保持を優先し、下記条件で追加保持|1問（1.5%）|53問（8.4%）|

追加保持条件：本数一致、8m/20mの一対一対応の最大角度差30度以内、AI保持スコア0.2以上。ルールで保持する地点は必ず保持する。AI単体の選択済み閾値（候補モデルでは0.5）と、ハイブリッドの0.2は別設定。

**上の1.5%は後から組み合わせを探索した旧OOF予測の再集計。最新候補モデルの独立テスト精度でも、相手アプリの精度でもない。** 各分割のテストに使ったモデルと、全データで学習した単一モデルは違う。

残る誤省略は京都②・問題33。画像は`handoff/koma-omission-handoff/docs/remaining-false-omission.png`。

訂正した問題は三浦④・問題42、pairId `cbb5c4e3-75f2-40af-b7ca-c5ea65d647f8:pair:42`。「明確/ギリギリ」のどちらかは指定されていないので、二値label=omitとchoice=user-corrected-omitを記録している。勝手にclearやborderlineへ置き換えない。

## 動作確認・再現

リポジトリ直下から、依存なしの確認：

```bash
python3 handoff/koma-omission-handoff/tools/verify_bundle.py
node --test handoff/koma-omission-handoff/tests/handoff.test.cjs handoff/koma-omission-handoff/source/tests/*.test.cjs
```

学習・推論・Pythonテストは専用の仮想環境を使用する。Python3.12、Node24で検証済み。

```bash
cd handoff/koma-omission-handoff
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s source/tests -p 'test_*.py'
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python runtime/predict.py < example-pairs.json
.venv/bin/python tools/reproduce.py recount --output work/recount
```

全学習や修正後の新しいCVを実施する場合は、同梱docs/REPRODUCIBILITY.mdを参照。元の予測再集計と、新たに学び直す実験の結果は別フォルダに保存する。検証済みの内訳はNode40件＋Python19件。元rawから697問への再構成、旧CVの全予測・モデル一致、候補モデルの再学習一致も確認済み。

静的アプリ自体は、リポジトリ直下で以下を実行する。

```bash
python3 -m http.server 8000 --directory site
```

8000が使用中なら既存サーバーを確認するか、8001等を使う。環境のポート表示からブラウザを開く。

## 移植時の残作業

指定先：`https://github.com/shotaciel5/MiuraWalkingRally/tree/feature/course-publication-controls`。最後に確認したHEADは`21adcfebdae2615d308637af3ab7b52c0a487fed`。受領時に最新版を確認する。

相手はNext.js/TypeScript、枝30m、隣接ノード基準のheading、描画はピクセル座標。元モデルは枝28m、実経路8m手前のheading、WGS84折れ線を前提にする。モデルをそのまま描画座標へ適用しない。アダプター、Python推論の実行方法またはTypeScript移植、保存/公開/CP/距離の整合性検証が必要。相手のAGENTS.mdと現在のユーザーの許可範囲を優先する。

独立問題⑧は本体のsite/dataにあるが、引き継ぎパッケージには含めていない。⑧の回答・予測を学習/条件調整へ混ぜない。必要な独立評価は条件を固定してから行う。

この移行の目的は作業再開を可能にすること。新しい変更指示がない限り、AIの本番適用、過去の依頼の再実装、mainへのマージ、サイト公開、相手リポジトリへのpushは行わない。
