# 京都駅周辺 コマ地図メーカー

三崎港版とは別のリポジトリ・ブラウザ保存領域で動く静的Webアプリです。京都駅北側を発着し、東本願寺・西本願寺・渉成園・梅小路公園・東寺の付近を巡るCP5か所のコースを用意します。実際の通行可否や営業時間は実施前に確認してください。

## 動作確認済み

実際のOpenStreetMapデータ（道路7,689本・経路用ノード26,853点）を同梱しています。基本のコマ地図生成に外部APIキーやデータ再取得は不要です。サンプルは後半の訪問順により約5.78〜5.99km、全175〜180コマ、省略版87〜98コマ、CP5か所になります。サンプル地点の参照元OSM IDと道路上への補正距離もデータに記録しています。

京都の実ルートを使うテストと、ブラウザでの生成・全表示切替・地図番号照合・手元の画像追加・JSON入出力・再読み込み・参加者表示・PDF出力を確認済みです。実際のGoogle Street View APIへの課金を伴う画像取得は行っていません。通行可否・営業時間などの現地確認は別途必要です。

## セットアップ

通常の起動はPython 3だけで可能です。データ更新・テストではNode.jsも使用します。外部パッケージのインストールは不要です。

```bash
cd /workspaces/kyoto-koma-map
python3 -m http.server 8000 --directory site
```

クラウド環境内のチェックアウトは `/workspace/kyoto-koma-map`、Codespacesの標準パスは `/workspaces/kyoto-koma-map` です。Codespacesではポート8000の「Open in Browser」で開いてください。既存チェックアウトを使用し、依頼がない限りGit worktreeは作りません。

道路データを更新する場合は、次を実行してください。

```bash
python3 scripts/fetch_osm.py
node scripts/prepare_sample.cjs
```

`fetch_osm.py` はOpenStreetMap公式APIから京都駅周辺のXMLを小さなタイルに分けて取得・重複排除し、道路、歩行制限、目印、標識、背景をJavaScriptへ変換します。`prepare_sample.cjs` は寺院・公園の種類を照合して同名の駅やバス停を除き、OSMの名所を近隣の道路へ補正し、後半の両訪問順で経路・CP数・コマ生成を検証してからサンプルを保存します。地点が欠ける場合や経路が成立しない場合は、架空の補間で埋めずにエラーにします。出典IDと補正距離はデータに残します。

外部から取得済みの公式XMLを使う場合:

```bash
python3 scripts/fetch_osm.py --input /path/to/kyoto.osm
node scripts/prepare_sample.cjs
```

更新した `site/data/kyoto-network.js` はサンプル検証後にコミットしてください。更新で取得データを作り直したらサンプル準備も再実行してください。

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
node tests/kyoto-data.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

京都データ取得後は `node scripts/prepare_sample.cjs` も必須です。実ブラウザでは、サンプル生成、全表示切替、番号一致、画像追加、JSON保存・読み込み、再読み込み、PDFを確認してください。実際の京都ルートでこれらのブラウザ検証は完了しています。

## GitHubでの作成・公開

リポジトリは https://github.com/ogawa333/kyoto-koma-map です。Codespacesはこのリポジトリの Code → Codespaces から作成できます。
GitHub Pagesは、公開する場合に Settings → Pages → Deploy from a branch → main → /(root) で公開できます。ルートの `index.html` から `site/index.html` へ移動します。公開はこの準備だけでは行われません。

必要な通信先: `api.openstreetmap.org`（道路データ取得）、`overpass-api.de`（アプリ内の任意データ更新）、`api.github.com`（GitHub API）、`github.com`（Git読み書き）。任意のGoogle画像確認には別途 `maps.googleapis.com`、WebフォントにはGoogle Fontsを使用します。

地図データ: © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright

類似判定は進入方向に対する枝道の左右を区別します。隣の交差点まで2m未満でも、道路の向きが読み取れれば判定に使います。実質的に長さのない道路だけを判別不能とします。復帰したコマの作成者向け説明には、比較先の最終コマ番号も表示します。

駐車場内通路（parking_aisle）の分岐は、本道の直進角度が25度未満で、ほかの枝道より20度以上直進に近い場合に限り、省略判定を続けます。駐車場通路をルート探索に追加する変更ではありません。駐車場側へ進む場合、曖昧なY字路、明示された通行制限・方向制限、標識がある場合は従来どおりコマを残します。旧保存データは訪問順と追記を保持して再計算します。類似交差点の省略防止判定や手動追記・CPにより、別の理由でコマが残る場合はあります。
