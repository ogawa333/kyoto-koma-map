#!/usr/bin/env python3
"""Paired A/B/C/D ablation with grouped inner tuning and frozen outer folds."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import random
from collections import Counter
import numpy as np
from sklearn.ensemble import RandomForestClassifier
import sklearn
import local_ai as ai
import junction_experiment_features as feature

PARAMETERS = dict(n_estimators=200, max_depth=5, min_samples_leaf=2, random_state=42, n_jobs=1)
MULTIPLIERS = (1, 2, 4)
THRESHOLDS = (.2, .3, .4, .5)
FN_COST = 5


def classifier(labels, multiplier=1):
    counts = Counter(labels)
    if set(counts) != {'keep', 'omit'}:
        raise ValueError('Both labels are required; do not search seeds based on results.')
    weights = {key:len(labels)/(2*count)*(multiplier if key=='keep' else 1) for key,count in counts.items()}
    return RandomForestClassifier(**PARAMETERS, class_weight=weights)


def inner_partition(rows, indices, seed, parts=3):
    groups = ai.components([rows[i] for i in indices], 12)
    random.Random(seed).shuffle(groups);groups.sort(key=lambda g:-len(g))
    bins = [[] for _ in range(parts)]
    for group in groups:
        chosen = min(range(parts), key=lambda i:(len(bins[i]), i))
        bins[chosen].extend(indices[j] for j in group)
    if any(not b for b in bins):
        raise ValueError('Insufficient independent groups')
    return [sorted(b) for b in bins]


def tune(rows, X, indices, seed):
    bins = inner_partition(rows, indices, seed)
    by_multiplier = {}
    for multiplier in MULTIPLIERS:
        predictions = {}
        for validation in bins:
            train = sorted(set(indices)-set(validation))
            labels = [rows[i]['label'] for i in train]
            model = classifier(labels, multiplier).fit(X[train], labels)
            probabilities = model.predict_proba(X[validation])[:,list(model.classes_).index('keep')]
            predictions.update(zip(validation, map(float, probabilities)))
        assert set(predictions) == set(indices)
        by_multiplier[multiplier] = predictions
    candidates = []
    for multiplier in MULTIPLIERS:
        for threshold in THRESHOLDS:
            metrics = ai.metrics([rows[i] for i in indices], ['keep' if by_multiplier[multiplier][i]>=threshold else 'omit' for i in indices])
            candidates.append(dict(multiplier=multiplier, threshold=threshold, loss=FN_COST*metrics['falseOmit']+metrics['unnecessaryKeep'], metrics=metrics))
    chosen = min(candidates, key=lambda c:(c['loss'], c['metrics']['falseOmit'], c['metrics']['unnecessaryKeep'], c['multiplier'], -c['threshold']))
    return chosen, candidates, bins


def export(clf, stage, threshold):
    model = ai.export_model(clf, threshold)
    model.update(format='kyoto-junction-ablation-forest', featureVersion=feature.VERSION+':'+stage,
                 stage=stage, inputPrecision='float32', experimental=True)
    return model


def predict_export(model, vector):
    # sklearn's trees receive float32 inputs; compare those exact values to the
    # double tree thresholds. This avoids changing branches at rounding edges.
    values = np.asarray(vector, dtype=np.float32).astype(float).tolist()
    scores = []
    for tree in model['trees']:
        node = 0
        while tree['left'][node] != -1:
            node = tree['left'][node] if values[tree['feature'][node]]<=tree['threshold'][node] else tree['right'][node]
        scores.append(tree['keepProbability'][node])
    return sum(scores)/len(scores)


def run(prepared, folds_dir, output):
    if output.exists() and any(output.iterdir()):
        raise ValueError('Choose a new output directory; preserve existing experiments.')
    output.mkdir(parents=True, exist_ok=True)
    rows = prepared['rows'];assert len(rows)>=10
    key_index = {r['key']:i for i,r in enumerate(rows)};assert len(key_index)==len(rows)
    computed = [feature.vectors(r) for r in rows]
    X = {stage:np.asarray([v[stage] for v in computed], dtype=float) for stage in 'ABCD'}
    plan = dict(stages={'A':'original histogram', 'B':'A + correspondence and angular gaps', 'C':'B + actual entry, multi-depth curves, visible radius and reach masks', 'D':'C + inner-only weight/threshold selection'},
                modelParameters=PARAMETERS, balancedClassWeight=True, multipliers=MULTIPLIERS, thresholds=THRESHOLDS,
                falseOmissionCost=FN_COST, unnecessaryKeepCost=1, innerParts=3, featureVersion=feature.VERSION,
                outerFolds='5 grouped folds; approximately 80/20', featureCounts={s:X[s].shape[1] for s in 'ABC'},
                selectedFinalAlgorithm='D selected before examining outer results',
                featureCodeSha256=hashlib.sha256(Path(feature.__file__).read_bytes()).hexdigest())
    ai.write_json(output/'plan.json', plan)
    predictions = [];fold_reports = [];tested = set()
    for fold in range(1,6):
        split = json.loads((folds_dir/f'fold-{fold}'/'split.json').read_text())
        train = [key_index[r['key']] for r in split['train']];test = [key_index[r['key']] for r in split['test']]
        assert len(train)+len(test)==len(rows) and abs(len(test)-len(rows)/5)<=1 and not set(train)&set(test)
        assert not tested&set(test);tested.update(test)
        assert not {g for i in train for g in rows[i]['groups']}&{g for i in test for g in rows[i]['groups']}
        # Verify the frozen split still respects the physical grouping.
        groups = ai.components(rows,12)
        assert all(set(g)<=set(train) or set(g)<=set(test) for g in groups)
        chosen, candidates, inner = tune(rows, X['C'], train, 142+fold)
        assert all(set(g)<=set(train) and not set(g)&set(test) for g in inner)
        folder = output/f'fold-{fold}';folder.mkdir()
        ai.write_json(folder/'split.json', split)
        ai.write_json(folder/'inner.json', dict(chosen=chosen,candidates=candidates,validationKeys=[[rows[i]['key'] for i in b] for b in inner]))
        report = dict(fold=fold,train=len(train),test=len(test),stages={},chosen=chosen)
        stage_predictions = {}
        for stage in 'ABCD':
            multiplier, threshold = (chosen['multiplier'],chosen['threshold']) if stage=='D' else (1,.5)
            labels = [rows[i]['label'] for i in train]
            clf = classifier(labels,multiplier).fit(X[stage][train], labels)
            native = clf.predict_proba(X[stage][test])[:,list(clf.classes_).index('keep')]
            model = export(clf,stage,threshold)
            probabilities = [predict_export(model,X[stage][i]) for i in test]
            assert np.allclose(native,probabilities,atol=1e-12,rtol=0)
            decisions = ['keep' if p>=threshold else 'omit' for p in probabilities]
            stage_predictions[stage] = (decisions,probabilities)
            report['stages'][stage] = ai.metrics([rows[i] for i in test],decisions)
            ai.write_json(folder/f'model-{stage}.json',model)
        for j,i in enumerate(test):
            r=rows[i];prediction=dict(fold=fold,key=r['key'],human=r['label'],choice=r['choice'],rule=r['rule'],references=r['references'])
            for stage in 'ABCD':prediction[stage]=stage_predictions[stage][0][j];prediction['score'+stage]=stage_predictions[stage][1][j]
            predictions.append(prediction)
        ai.write_json(folder/'metrics.json', report);fold_reports.append(report)
        print(json.dumps(dict(fold=fold,chosen=[chosen['multiplier'],chosen['threshold']],falseOmit={s:report['stages'][s]['falseOmit'] for s in 'ABCD'})),flush=True)
    assert tested==set(range(len(rows)))
    summary = {s:ai.metrics([dict(label=p['human'],choice=p['choice']) for p in predictions],[p[s] for p in predictions]) for s in ['rule','A','B','C','D']}
    # Freeze the predeclared D pipeline on all eligible rows. No outer-score model selection.
    chosen, candidates, inner = tune(rows,X['C'],list(range(len(rows))),242)
    labels = [r['label'] for r in rows]
    clf = classifier(labels,chosen['multiplier']).fit(X['C'],labels)
    model = export(clf,'D',chosen['threshold']);ai.write_json(output/'frozen-model.json',model)
    ai.write_json(output/'final-inner.json',dict(chosen=chosen,candidates=candidates,validationKeys=[[rows[i]['key'] for i in b] for b in inner]))
    manifest = dict(modelSha256=hashlib.sha256((output/'frozen-model.json').read_bytes()).hexdigest(),plan=plan,chosen=chosen,
                    inputFiles=prepared['inputFiles'],entrySources=prepared['entrySources'],sklearnVersion=sklearn.__version__,
                    finalTestStatus='pending human answers to a new, disjoint unanswered set',finalTestPredictionsViewed=False)
    ai.write_json(output/'freeze.json',manifest)
    ai.write_json(output/'results.json',dict(plan=plan,summary=summary,folds=fold_reports,finalChosen=chosen,coverage=dict(uniqueTestPairs=len(rows),totalAppearances=len(predictions))))
    with (output/'predictions.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(predictions[0]));writer.writeheader();writer.writerows([{**p,'references':json.dumps(p['references'])} for p in predictions])
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prepared',type=Path);parser.add_argument('--folds-dir',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    run(json.loads(args.prepared.read_text()),args.folds_dir,args.output)
