# 京都駅周辺 コマ地図メーカー

三崎港版とは別のリポジトリ・ブラウザ保存領域で動く静的Webアプリです。京都駅北側を発着し、東本願寺・西本願寺・渉成園・梅小路公園・東寺の付近を巡るCP5か所のコースを用意します。実際の通行可否や営業時間は実施前に確認してください。

## 現在の状態

アプリと取得・検証スクリプトは準備済みです。クラウド環境の通信制限により、実際の京都OSMデータの取得とGitHub上の新規リポジトリ作成は未完了です。`site/data/kyoto-network.js` は未準備を示すファイルであり、架空の道路や三浦の道路を京都の道路として使っていません。データ取得とサンプル検証が完了するまではアプリの経路生成は使えません。

## セットアップ

Python 3とNode.jsを使用します。外部パッケージのインストールは不要です。

```bash
cd /workspaces/kyoto-koma-map
python3 scripts/fetch_osm.py
node scripts/prepare_sample.cjs
python3 -m http.server 8000 --directory site
```

クラウド環境内のチェックアウトは `/workspace/kyoto-koma-map`、Codespacesの標準パスは `/workspaces/kyoto-koma-map` です。Codespacesではポート8000の「Open in Browser」で開いてください。既存チェックアウトを使用し、依頼がない限りGit worktreeは作りません。

`fetch_osm.py` はOpenStreetMap公式APIから京都駅周辺のXMLを取得し、道路、歩行制限、目印、標識、背景をJavaScriptへ変換します。`prepare_sample.cjs` はOSMの名所を近隣の道路へ補正し、後半の両訪問順で経路・CP数・コマ生成を検証してからサンプルを保存します。地点が欠ける場合や経路が成立しない場合は、架空の補間で埋めずにエラーにします。出典IDと補正距離はデータに残します。

外部から取得済みの公式XMLを使う場合:

```bash
python3 scripts/fetch_osm.py --input /path/to/kyoto.osm
node scripts/prepare_sample.cjs
```

実際のOSMデータ取得・サンプル検証後に `site/data/kyoto-network.js` をコミットすれば、基本機能は外部APIキーなしで動きます。更新で取得データを作り直したらサンプル準備も再実行してください。

## 機能

- 道路をA*法で探索し、歩行禁止等を考慮（階段は距離を1.12倍で評価）
- 全交差点／道なり省略の切替。次のコマに似た省略交差点を復帰
- 類似判定は道の本数一致を必須とし、進入方向をそろえて枝道の角度差20度以内を比較
- 経由地は前半を直線距離で近い順、後半をランダムに訪問。入力順も選択可能
- 全体図にコマ番号を表示し、クリックで該当コマへ移動
- 看板・目印は交差点から10m以内、道路標識・信号は28m以内
- 手元のJPEG/PNG/WebPをコマのイラストと差し替え。保存用JSON・印刷・PDFに含める
- Google Street Viewの画像確認は任意。APIキーと課金設定が必要。キーは確認画面のメモリ内だけで使用し、画像・キーはJSONやPDFに含めない
- 京都版の保存キーとJSON形式を使用し、三浦版の保存データとは区別

基本のルート作成や手元の写真追加にGoogleの課金は不要です。道路幅、センターライン、勾配など未登録の情報は自動では判定できません。現地確認を行ってください。

## テスト

```bash
node tests/routing.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

京都データ取得後は `node scripts/prepare_sample.cjs` も必須です。実ブラウザでは、サンプル生成、全表示切替、番号一致、画像追加、JSON保存・読み込み、再読み込み、PDFを確認してください。現時点で実際の京都ルートのブラウザ検証は未完了です。

## GitHubでの作成・公開

新規リポジトリ候補名は `ogawa333/kyoto-koma-map` です。GitHub APIでの作成が許可されない場合は、GitHub上で空のリポジトリを作成し、このローカルリポジトリの `main` をpushします。既存リポジトリを上書きしないでください。

GitHub Pagesは、実データの準備と動作確認後に Settings → Pages → Deploy from a branch → main → /(root) で公開できます。ルートの `index.html` から `site/index.html` へ移動します。公開はこの準備だけでは行われません。

必要な通信先: `api.openstreetmap.org`（道路データ取得）、`overpass-api.de`（アプリ内の任意データ更新）、`api.github.com`（GitHub API）、`github.com`（Git読み書き）。任意のGoogle画像確認には別途 `maps.googleapis.com`、WebフォントにはGoogle Fontsを使用します。

地図データ: © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright
