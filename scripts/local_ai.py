#!/usr/bin/env python3
"""Train and compare a small local junction classifier. No network calls."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import sys

FEATURE_VERSION = 'oriented-8m-20m-histogram-v1'
BINS = 24


def features(signatures):
    """Only approach-normalized shape. Never labels, rule, location or identity."""
    histograms = []
    for signature in signatures:
        frame = []
        for depth in range(2):
            # Circular soft histogram preserves left/right and avoids bin-edge jumps.
            bins = [0.0] * BINS
            for branch in signature:
                position = ((branch[depth] + math.pi) % (2 * math.pi)) / (2 * math.pi) * BINS
                index = math.floor(position)
                fraction = position - index
                bins[index % BINS] += 1 - fraction
                bins[(index + 1) % BINS] += fraction
            frame.extend(bins)
        histograms.append(frame)
    a, b = histograms
    return [len(signatures[0]), len(signatures[1]), abs(len(signatures[0]) - len(signatures[1]))] + a + b + [abs(x-y) for x, y in zip(a, b)]


def distance(a, b):
    lat1, lat2 = math.radians(a['lat']), math.radians(b['lat'])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(b['lon']-a['lon'])/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


def components(rows, merge_meters=12):
    """Union both endpoints, repeated IDs, and nearby distinct OSM nodes."""
    parent = list(range(len(rows)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union(a, b):
        parent[find(b)] = find(a)
    owners, points = {}, []
    for i, row in enumerate(rows):
        for group in row['groups']:
            if group in owners:
                union(i, owners[group])
            owners[group] = i
        for point in row['centers']:
            # Grouping only, these coordinates never enter features().
            for other, j in points:
                if distance(point, other) <= merge_meters:
                    union(i, j)
            points.append((point, i))
    groups = {}
    for i in range(len(rows)):
        groups.setdefault(find(i), []).append(i)
    return sorted(groups.values(), key=lambda indices: rows[indices[0]]['key'])


def split_rows(rows, fraction=.25, seed=42, merge_meters=12):
    groups = components(rows, merge_meters)
    if len(groups) < 2:
        raise ValueError('交差点がすべて連結されています。別エリアの回答済み評価セットを追加してください。')
    # Fixed seeded group split. Do not search seeds based on validation accuracy.
    random.Random(seed).shuffle(groups)
    validation, train = [], []
    target = len(rows) * fraction
    for group in groups[:-1]:
        if len(validation) < target:
            validation.extend(group)
        else:
            train.extend(group)
    train.extend(groups[-1])
    if any(len({rows[i]['label'] for i in subset}) < 2 for subset in (train, validation)):
        raise ValueError('固定分割の学習側または検証側に両ラベルがありません。別エリアの評価セットを追加してください。精度を見て乱数を選び直さないでください。')
    train_groups = {g for i in train for g in rows[i]['groups']}
    validation_groups = {g for i in validation for g in rows[i]['groups']}
    if train_groups & validation_groups:
        raise AssertionError('Physical intersection leakage')
    return sorted(train), sorted(validation), len(groups)


def metrics(rows, predictions):
    counts = dict(trueKeep=0, falseOmit=0, unnecessaryKeep=0, trueOmit=0, borderline=0, borderlineOmitted=0)
    for row, predicted in zip(rows, predictions):
        human = row['label']
        key = ('trueKeep' if predicted == 'keep' else 'falseOmit') if human == 'keep' else ('unnecessaryKeep' if predicted == 'keep' else 'trueOmit')
        counts[key] += 1
        if row['choice'] == 'borderline':
            counts['borderline'] += 1
            counts['borderlineOmitted'] += predicted == 'omit'
    def ratio(a, b):
        return a / b if b else None
    return dict(counts, n=len(rows), accuracy=ratio(counts['trueKeep']+counts['trueOmit'], len(rows)),
                falseOmissionRate=ratio(counts['falseOmit'], counts['trueKeep']+counts['falseOmit']),
                unnecessaryKeepRate=ratio(counts['unnecessaryKeep'], counts['unnecessaryKeep']+counts['trueOmit']),
                borderlineOmissionRate=ratio(counts['borderlineOmitted'], counts['borderline']))


def predict_probability(model, vector):
    if model['featureVersion'] != FEATURE_VERSION or len(vector) != model['featureCount']:
        raise ValueError('モデルの特徴量バージョンが一致しません。')
    probabilities = []
    for tree in model['trees']:
        node = 0
        while tree['left'][node] != -1:
            node = tree['left'][node] if vector[tree['feature'][node]] <= tree['threshold'][node] else tree['right'][node]
        probabilities.append(tree['keepProbability'][node])
    return sum(probabilities) / len(probabilities)


def export_model(classifier, threshold):
    keep_index = list(classifier.classes_).index('keep')
    trees = []
    for estimator in classifier.estimators_:
        t = estimator.tree_
        probabilities = [float(values[0][keep_index] / sum(values[0])) for values in t.value]
        trees.append(dict(left=t.children_left.tolist(), right=t.children_right.tolist(), feature=t.feature.tolist(), threshold=t.threshold.tolist(), keepProbability=probabilities))
    return dict(format='kyoto-local-junction-forest', version=1, featureVersion=FEATURE_VERSION,
                featureCount=classifier.n_features_in_, keepThreshold=threshold, trees=trees)


def load_exports(files, evaluator):
    helper = Path(__file__).with_name('prepare_evaluations.cjs')
    result = subprocess.run(['node', str(helper), evaluator, *map(str, files)], capture_output=True, text=True)
    if result.returncode:
        raise ValueError(result.stderr.strip())
    return json.loads(result.stdout)


def train(args):
    from sklearn.ensemble import RandomForestClassifier
    import sklearn
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError('出力先に既存の結果があります。比較結果を残すため別の--outputを指定してください。')
    prepared = load_exports(args.inputs, args.evaluator)
    rows = prepared['rows']
    train_indices, val_indices, group_count = split_rows(rows, args.validation_fraction, args.seed, args.merge_meters)
    classifier = RandomForestClassifier(n_estimators=200, max_depth=5, min_samples_leaf=2, class_weight='balanced', random_state=args.seed, n_jobs=1)
    classifier.fit([features(rows[i]['signatures']) for i in train_indices], [rows[i]['label'] for i in train_indices])
    model = export_model(classifier, args.keep_threshold)
    validation = [rows[i] for i in val_indices]
    probabilities = [predict_probability(model, features(r['signatures'])) for r in validation]
    ai = ['keep' if p >= args.keep_threshold else 'omit' for p in probabilities]
    fingerprint = hashlib.sha256(json.dumps([(r['key'], r['label'], r['choice'], r['rule'], r['groups'], r['centers']) for r in rows], sort_keys=True).encode()).hexdigest()
    report = dict(datasetIds=prepared['datasetIds'], evaluatorId=args.evaluator, ruleVersion=prepared['ruleVersion'], uniqueAnsweredPairs=len(rows),
                  excluded=prepared['excluded'], connectedComponents=group_count, trainPairs=len(train_indices), validationPairs=len(val_indices),
                  seed=args.seed, mergeMeters=args.merge_meters, validationFraction=args.validation_fraction,
                  keepThreshold=args.keep_threshold, dataFingerprint=fingerprint, sklearnVersion=sklearn.__version__,
                  validation=dict(rule=metrics(validation, [r['rule'] for r in validation]), ai=metrics(validation, ai),
                                  alwaysOmit=metrics(validation, ['omit']*len(validation))))
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    write_json(output/'model.json', model)
    write_json(output/'report.json', report)
    write_json(output/'split.json', dict(dataFingerprint=fingerprint, seed=args.seed, mergeMeters=args.merge_meters,
        train=[dict(key=rows[i]['key'], groups=rows[i]['groups'], references=rows[i]['references']) for i in train_indices],
        validation=[dict(key=rows[i]['key'], groups=rows[i]['groups'], references=rows[i]['references']) for i in val_indices]))
    with (output/'validation.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['key', 'references', 'human', 'choice', 'rule', 'ai', 'keepProbability'])
        for r, predicted, probability in zip(validation, ai, probabilities):
            writer.writerow([r['key'], json.dumps(r['references']), r['label'], r['choice'], r['rule'], predicted, probability])
    def percent(v):
        return '—' if v is None else f'{v:.1%}'
    text = f'# ローカル交差点AIの検証\n\n回答済みセット {len(prepared["datasetIds"])}件、重複を除く {len(rows)}ペア。学習 {len(train_indices)}、検証 {len(val_indices)}。評価者 {args.evaluator}。\n\n'
    text += '| 検証用データでの指標 | 固定ルール | ローカルAI |\n|---|---:|---:|\n'
    for label, field in [('一致率', 'accuracy'), ('残すべき地点の誤省略率', 'falseOmissionRate'), ('省略できる地点の不要保持率', 'unnecessaryKeepRate'), ('ギリギリ区別できる地点の省略率', 'borderlineOmissionRate')]:
        text += f'| {label} | {percent(report["validation"]["rule"][field])} | {percent(report["validation"]["ai"][field])} |\n'
    text += '\n分母・件数はreport.jsonを参照してください。判定閾値は検証前に固定し、検証成績による自動調整を行いません。検証は一人の図形評価に対する予備実験です。全100問の87%との直接比較はできません。同じ検証結果を見ながら調整を重ねた場合、別エリアの未使用テストセットが必要です。\n\n'
    text += '同じ交差点IDを共有するペアと、設定距離以内の別ノードの交差点を連結成分にまとめて分割しました。距離だけでは同一交差点の全ケースを識別できないためsplit.jsonの現地対応も確認してください。絶対座標・ルール判定・人の回答・評価者・ID・コース情報はモデル特徴に含めません。\n\n'
    text += 'モデルは道路形状の8m・20m地点の進入方向に対する角度を使う小規模ランダムフォレストです。左右は反転しません。信号・写真・進路矢印は入力しません。今回のモデルをアプリの省略判定へ自動適用する変更は行いません。\n'
    (output/'report.md').write_text(text, encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('train', help='複数の回答済みJSONを統合・分割して学習と比較')
    p.add_argument('inputs', nargs='+', type=Path)
    p.add_argument('--evaluator', default='P001')
    p.add_argument('--output', type=Path, default=Path('local-ai/output'))
    p.add_argument('--seed', type=int, default=42)
    p.add_argument('--validation-fraction', type=float, default=.25)
    p.add_argument('--merge-meters', type=float, default=12)
    p.add_argument('--keep-threshold', type=float, default=.5)
    p.set_defaults(run=train)
    p = sub.add_parser('predict', help='保存済みJSONモデルを道路形状ペアに適用')
    p.add_argument('--model', required=True, type=Path)
    p.add_argument('input', type=Path, help='modelInputを含む単一ペアJSON（回答不要）')
    def predict(args):
        # Derive signatures through the same app geometry, without reading answers.
        pair = json.loads(args.input.read_text(encoding='utf-8'))
        routing = Path(__file__).resolve().parents[1]/'site/routing.js'
        code = 'const r=require(process.argv[1]);const p=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify([r.junctionSignature(p.modelInput.candidate),r.junctionSignature(p.modelInput.target)]));'
        signatures = json.loads(subprocess.check_output(['node', '-e', code, str(routing)], input=json.dumps(pair), text=True))
        if any(s is None for s in signatures):
            print(json.dumps(dict(prediction='keep', reason='insufficient geometry')))
            return
        model = json.loads(args.model.read_text(encoding='utf-8'))
        probability = predict_probability(model, features(signatures))
        print(json.dumps(dict(prediction='keep' if probability >= model['keepThreshold'] else 'omit', keepProbability=probability)))
    p.set_defaults(run=predict)
    args = parser.parse_args()
    if args.command == 'train' and (not 0 < args.validation_fraction < 1 or not 0 < args.keep_threshold < 1 or not math.isfinite(args.merge_meters) or args.merge_meters < 0):
        parser.error('fraction/threshold must be between 0 and 1; merge-meters must be finite and nonnegative')
    try:
        args.run(args)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, str(error)+'\n')


if __name__ == '__main__':
    main()
