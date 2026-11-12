"""Portable historical replay or retraining using fixed physical-junction groups."""
import argparse,csv,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'source/scripts'))
import local_ai as ai
from run_junction_ablation import run
p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','recount','cv-original','cv-corrected']);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
if a.output.exists():raise SystemExit('Choose a new output directory.')
a.output.mkdir(parents=True)
if a.action=='prepare':
 subprocess.run(['node',str(ROOT/'source/scripts/prepare_junction_ablation.cjs'),str(a.output/'prepared-original.json'),*[str(ROOT/f'data/raw/set-{i:02d}.json') for i in range(1,8)]],check=True)
 d=json.loads((a.output/'prepared-original.json').read_text());saved=json.loads((ROOT/'data/prepared-original-697.json').read_text());assert d['rows']==saved['rows']
 correction=json.loads((ROOT/'experiments/corrected-recount/label-correction.json').read_text())
 for r in d['rows']:
  if r['key']==correction['geometryKey']:r.update(label='omit',choice='user-corrected-omit',labelCorrection=correction)
 assert sum(r['label']=='keep' for r in d['rows'])==67
 (a.output/'prepared-corrected.json').write_text(json.dumps(d,ensure_ascii=False))
 print('Raw export reconstruction + exclusions + binary-label correction: PASS')
elif a.action=='recount':
 with (ROOT/'experiments/corrected-recount/predictions-corrected.csv').open(encoding='utf-8-sig') as f:rows=list(csv.DictReader(f))
 g=json.loads((ROOT/'experiments/geometry.json').read_text())
 methods={'current-rule':lambda r:r['rule'],'both-must-omit':lambda r:'omit' if r['rule']=='omit' and r['D']=='omit' else 'keep','guard30-score02':lambda r:'keep' if r['rule']=='keep' or (g[r['key']]['sameCount'] and g[r['key']]['angle']<=30 and float(r['scoreD'])>=.2) else 'omit'}
 data=[dict(label=r['human'],choice=r['choice']) for r in rows];metrics={k:ai.metrics(data,[fn(r) for r in rows]) for k,fn in methods.items()}
 expected=json.loads((ROOT/'experiments/corrected-recount/results.json').read_text())['results'];assert metrics==expected
 (a.output/'metrics.json').write_text(json.dumps(metrics,indent=2));print('Historical fixed-prediction recount: PASS (FN 4/4/1; FP 42/50/53)')
else:
 name='original' if a.action=='cv-original' else 'corrected'
 data=json.loads((ROOT/f'data/prepared-{name}-697.json').read_text())
 run(data,ROOT/'experiments/original-697',a.output/'results')
 print('Finished grouped nested CV. Corrected-label retraining is a NEW experiment, not the historical recount.')
