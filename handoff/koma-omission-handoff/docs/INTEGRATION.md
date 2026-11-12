# MiuraWalkingRallyへの組み込み

対象：shotaciel5/MiuraWalkingRally、feature/course-publication-controls。
確認したリモートHEAD：`21adcfebdae2615d308637af3ab7b52c0a487fed`（2026-11-12）。ローカル参照コードとGitHubのHEADが一致することを確認済み。受領時に再確認する。

## 対応箇所

|相手のファイル|役割|組み込み方|
|---|---|---|
|lib/route/junctions.ts のbuildRoadBranches/extractJunctions|物理枝・実経路から候補を生成|原則維持。歩行制限・review状態を勝手に変更しない|
|lib/route/koma.ts のcreateKomaMaps/traceBranch|30m、隣接ノード方位、ピクセル座標の描画|既存表示を維持する場合、学習用の28m/8m互換形状を別途生成。元のモデルへSVG座標を直接入力しない|
|lib/operator/rally-preview.ts のcreateRallyPreview|route→analysis→maps→cards|全候補の形状生成後に省略選別を追加。表示/保存/公開で同じ選別結果を使う|
|lib/route/koma-cards.ts のbindKomaCards|コマ・距離・地点の結合|残すコマが確定した後の採番、距離、stop参照の再計算を確認|
|lib/operator/course-format.ts 等|保存形式検証|モード・ルール/モデル版・表示対象・保留理由の保存/復元を必要に応じて拡張|

表示だけをCSSで隠すと、保存コース、次への移動、CPのindex、距離、公開時の検証が食い違う。内部の全候補と、表示に使う選別結果の対応を保持する。

## 形状の違い

元アプリは実ルート上の8m手前を基準に向きをそろえ、枝は28mまたは次の実交差点まで。相手は原則30mで、直前の隣接ノードの方位をheadingにする。相手の`KomaBranch.points`は投影済み300×280座標。短い進入/退出枝は30px未満でheldにされ、通常branchesは空にされる。

したがってモデルJSONだけの貼り付けでは互換にならない。`sourceSegments`、元のgraph.nodes/ways、経路nodeIdsを使う。`integration/target-adapter.cjs`は相手のGraph/JunctionCandidateを受け取り、元エンジンの枝の抽出で互換WGS84形状を作る例。target-referenceは調査資料であって受領先への上書き用ではない。

アダプターの使い方：

```js
const {compatibilityGraph, frameFromCandidate} = require('./handoff/integration/target-adapter.cjs');
const g = compatibilityGraph(graph);
const shape = frameFromCandidate(g, candidate, approachFromCenter);
```

`approachFromCenter`は中心から経路を逆順にたどる実点列で、8m以上あるか、直前のCP/折り返しに届くまで。描画線からの逆推定は禁止。この互換グラフは形状計算用であり、相手のアクセス制約付き経路グラフを置換するものではない。

相手の道路採用ポリシーと元エンジンのvisual枝ポリシーも異なる。枝の集合が一致しなければ差分を記録して保持/要確認とする。歩道、横断歩道、駐車場通路、立体交差、接続補正ノードは特に比較する。切り出し条件を変えて描画まで変える場合、従来の人の回答がそのまま適用できるとは限らない。

## コマ選別の順序

1. 元の全候補を保持しておく。
2. 道なりが明確なものだけ`canOmit=true`にする。ペア分類器だけではこれを決められない。
3. 開始/終了、stop/CP、折り返し、必須右左折、手動編集、held、issues、不明情報は`canOmit=false`。元の`continuation(g, routeNodeIds, pathIndex)`を移植する場合も、この相手独自の保護を上乗せする。すべての直進を省略候補にしない。
4. source/site/routing.jsの`continuation`は、直進角25度未満・他枝との差20度以上、明示的な幅/路面の継続、緩い分岐の角度差等を用いる。未知の幅/中央線/勾配を推測しない。駐車場内通路の例外も明確な本道の継続がある場合だけ。
5. `retainedForStraightSignal`は単に信号アイコンがあるかではなく、「直進で、信号を無視してcontinuationを再計算した場合だけ省略可能になる」ことから求める。CP/編集があれば信号例外は使わない。
6. runtime/select-frames.cjsの`selectFrames(frames, {mode,edits,scorePair})`へ渡す。frameには`id, at, center, heading, branches, canOmit, checkpoints, label, retainedForStraightSignal, routeIn, incomingBranchIndex`を対応させる。欠損canOmitは保持として扱う。正確なフィールドは元実装とテストを参照。
7. A→Dの省略候補BがDに似ていればBを復帰させ、区間を再分割して再試行。直進Dも比較する。信号による直進保持のDは境界だけ更新し、比較対象から外す。
8. 表示が確定してから番号・次コマまでの距離・全体図・CPの参照・保存コースを更新。元のルート距離や全候補のIDは失わない。

ラッパーの出力`fromPrevious`は前の表示コマからの距離。相手の`metersToNext`は次の表示コマとの`at`差から再計算し、最終コマはnull。`at`は進行順の累積距離で同じ場所の再訪は別IDにする。

## PythonとNext.js

この一式は参照用のNode＋Python実装。相手はNext.js/TypeScriptなので、次のどちらかを選ぶ。

- ローカル/常駐サーバー：Nodeサーバー側から`runtime/predict.py`へJSON配列を標準入力で渡す。`--jsonl`はモデルを1度だけ読み込み、入力行ごとに応答する。各呼び出しごとにPythonを起動する方法は動作確認用。実用時はバッチ化/常駐ワーカーとキャッシュを使う。
- ブラウザ/Nodeだけで完結：350特徴量と森林推論をTypeScriptへ移植。tests/golden.jsonの全特徴量を誤差1e-9以内、保持スコアを1e-12以内で比較し、しきい値境界の判定を一致させる。JSではMath.froundで各特徴量をfloat32化する。ハンガリアン/最小最大対応と枝のソートも同じにする。

Amplify HostingのNext.js環境でPythonがそのまま使えるという前提にはしない。実行基盤に合わせて選択し、AWS作成やデプロイは受領者の承認範囲で行う。

## 組み込み完了の確認

- allモードで元アプリと同じ全コマ、ruleモードで元ルールと同じ選別になる。
- 左右T字路を区別し、枝本数の不一致を追加条件で無条件に似ているとしない。
- 短い枝、複数交差点の接続、再訪、進入方向違いをテストする。
- AIで必須地点を省略しない。障害/欠損時は保持する。直進信号の例外が右左折信号へ広がらない。
- golden12問、旧OOF697問の森林推論、既存相手アプリのtest/typecheck/buildを通す。
- 保存・再読込・公開プレビュー・コマ送り・CP・全体図で同じ番号と表示対象を使う。

相手の実アプリにパッチを当てたE2E検証は、このパッケージ作成では実施していない。ここにあるアダプターは単体テスト済みの出発点で、受領側での現物検証が必要。
