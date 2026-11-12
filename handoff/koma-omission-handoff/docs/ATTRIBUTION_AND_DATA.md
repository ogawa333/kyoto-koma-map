# 出典・データの扱い

- 主なコード：ogawa333/kyoto-koma-map、コミットcc6d9699a1d8df1ec42cd433ac40d8e016f70292。この配布のruntime/tools/docsは今回の引き継ぎ用追加物。
- 移植先参照4ファイル：shotaciel5/MiuraWalkingRally、コミット21adcfebdae2615d308637af3ab7b52c0a487fed。統合先の現物との対応確認に用いる。元リポジトリの規定を尊重する。
- どちらの参照ルートにもLICENSEファイルは確認できなかった。この梱包で新しいオープンソースライセンスを付与したり、権利者の許諾範囲を拡張したりはしていない。別途公開・再配布する場合の条件は各権利者と確認する。
- 道路座標・ネットワークの出典：© OpenStreetMap contributors、Open Database License (ODbL)。https://www.openstreetmap.org/copyright 、https://opendatacommons.org/licenses/odbl/1-0/ 。利用画面の帰属表示や、派生データベースの公開/再配布時の義務を確認する。学習モデルの成績が道路データの正確さを保証するものではない。
- rawはユーザーが共有を希望した評価データ。匿名ID P001の選択・理由欄・評価日時・操作時間等を元のまま含む。APIキー、アカウント認証情報、ブラウザ履歴は含めていない。写真、Google Street View画像も含めていない。
- rawは訂正前を保存し、最新の二値訂正は別記録。data/prepared-corrected-697.jsonを今後の学習の起点とする。テストの独立性を損なわないよう、未知問題⑧は意図的に未同梱。
- numpy/scipy/scikit-learn等の依存バイナリやnode_modulesは同梱していない。requirements.txtによって各配布元からインストールする。
