#!/usr/bin/env python3
"""Evaluate the locked model only after the independent test has human answers."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import local_ai as ai
import junction_experiment_features as feature
from run_junction_ablation import predict_export


def evaluate(answer_file, model_file, freeze_file, original_file, source_file):
    answers=json.loads(answer_file.read_text());original=json.loads(original_file.read_text());source=json.loads(source_file.read_text());freeze=json.loads(freeze_file.read_text())
    if hashlib.sha256(original_file.read_bytes()).hexdigest()!=source['datasetSha256']:
        raise ValueError('Original final-test file changed after locking')
    if answers['id']!=source['id'] or answers['pairs']!=original['pairs'] or answers['source']!=original['source']:
        raise ValueError('Final-test questions changed')
    digest=hashlib.sha256(model_file.read_bytes()).hexdigest()
    if digest!=source['frozenModelSha256'] or digest!=freeze['modelSha256']:
        raise ValueError('The model differs from the pre-test frozen model')
    if hashlib.sha256(Path(feature.__file__).read_bytes()).hexdigest()!=freeze['plan']['featureCodeSha256']:
        raise ValueError('Feature implementation changed after freezing')
    responses=[r for r in answers['responses'] if r['evaluatorId']=='P001']
    if len({r['pairId'] for r in responses})!=len(original['pairs']):
        return dict(status='pending human answers',answered=len(responses),required=len(original['pairs']),predictionsComputed=False)
    helper=Path(__file__).with_name('prepare_junction_ablation.cjs')
    code='const {build}=require(process.argv[1]);process.stdout.write(JSON.stringify(build([process.argv[2]])));'
    result=subprocess.run(['node','-e',code,str(helper),str(answer_file)],text=True,capture_output=True,check=True)
    prepared=json.loads(result.stdout);rows=prepared['rows'];model=json.loads(model_file.read_text())
    if not rows:
        raise ValueError('No blinded, valid human labels to evaluate')
    known=source['excludedJunctions']
    for row in rows:
        if any(g==old['group'] for g in row['groups'] for old in known) or any(ai.distance(c,old['center'])<=12 for c in row['centers'] for old in known):
            raise ValueError('Final test shares a training junction or a center within 12m')
    probabilities=[predict_export(model,feature.vectors(r)['D']) for r in rows]
    predictions=['keep' if p>=model['keepThreshold'] else 'omit' for p in probabilities]
    original_rules={p['id']:p['rulePrediction'] for p in original['pairs']}
    rule_predictions=[original_rules[r['references'][0]['pairId']] for r in rows]
    return dict(status='completed frozen final test',n=len(rows),excluded=prepared['excluded'],modelSha256=digest,
                ruleVersion=original['source']['ruleVersion'],model=ai.metrics(rows,predictions),rule=ai.metrics(rows,rule_predictions),
                predictions=[dict(references=r['references'],human=r['label'],prediction=p,keepScore=s) for r,p,s in zip(rows,predictions,probabilities)])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['answers','model','freeze','original','source']:parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(evaluate(args.answers,args.model,args.freeze,args.original,args.source),ensure_ascii=False,indent=2))
