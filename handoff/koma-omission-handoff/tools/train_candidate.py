"""Train corrected-label candidate; NOT an independent accuracy evaluation."""
import argparse,hashlib,json,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'source/scripts'))
import junction_experiment_features as features
import run_junction_ablation as exp
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args()
if a.output.exists():raise SystemExit('Output exists; preserve previous runs.')
a.output.mkdir(parents=True)
data=ROOT/'data/prepared-corrected-697.json';rows=json.loads(data.read_text())['rows']
X=np.asarray([features.vectors(r)['D'] for r in rows]);labels=[r['label'] for r in rows]
chosen,candidates,inner=exp.tune(rows,X,list(range(len(rows))),242)
clf=exp.classifier(labels,chosen['multiplier']).fit(X,labels)
model=exp.export(clf,'D',chosen['threshold']);model.update(trainingDataSha256=hashlib.sha256(data.read_bytes()).hexdigest(),trainingLabelRevision='case-01-omit',independentlyValidated=False)
path=a.output/'model.json';path.write_text(json.dumps(model,ensure_ascii=False,indent=2))
manifest=dict(modelSha256=hashlib.sha256(path.read_bytes()).hexdigest(),chosen=chosen,candidates=candidates,validationKeys=[[rows[i]['key'] for i in b] for b in inner],keep=labels.count('keep'),omit=labels.count('omit'),independentlyValidated=False,warning='Prior 1/67 corrected recount uses old outer-fold models; not this full-data candidate.')
(a.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
np.testing.assert_allclose([exp.predict_export(model,x) for x in X],clf.predict_proba(X)[:,list(clf.classes_).index('keep')],atol=1e-12,rtol=0)
print(json.dumps(dict(chosen=chosen,n=len(rows),roundtrip=True),ensure_ascii=False))
