"""Batch JSON/JSONL CLI. Shape features + exported forest; no web or API keys."""
import argparse,json,sys,subprocess,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'source/scripts'))
import junction_experiment_features as features

def forest_score(model,vector):
 if model['featureVersion']!=features.VERSION+':D' or model.get('inputPrecision')!='float32':raise ValueError('Unsupported feature/model version')
 values=np.asarray(vector,dtype=np.float32).astype(float).tolist()
 if len(values)!=350 or not all(math.isfinite(v) for v in values):raise ValueError('Invalid 350-feature vector')
 scores=[]
 for tree in model['trees']:
  node=0
  while tree['left'][node]!=-1:
   node=tree['left'][node] if values[tree['feature'][node]]<=tree['threshold'][node] else tree['right'][node]
  scores.append(tree['keepProbability'][node])
 return sum(scores)/len(scores)

def decide(prepared,model):
 if prepared.get('error'):return dict(decision='keep',reason='invalid-geometry',error=prepared['error'])
 if prepared['rule']=='keep':return dict(decision='keep',rule='keep',reason='current-rule-keep')
 if not prepared['entryKnown']:return dict(decision='keep',rule='omit',reason='incoming-branch-unknown')
 score=forest_score(model,features.vectors(prepared['row'])['D']);g=prepared['geometry']
 guard=g['sameCount'] and g['angle']<=30 and score>=.2
 return dict(decision='keep' if guard else 'omit',rule=prepared['rule'],reason='ai-geometry-guard' if guard else 'omit-candidate',keepScore=score,maxAngleDegrees=g['angle'],counts=g['counts'],experimental=True)

def main():
 p=argparse.ArgumentParser();p.add_argument('--model',type=Path,default=ROOT/'models/corrected-candidate/model.json');p.add_argument('--jsonl',action='store_true');args=p.parse_args();model=json.loads(args.model.read_text())
 def batch(value):
  r=subprocess.run(['node',str(ROOT/'runtime/geometry.cjs')],input=json.dumps(value),text=True,capture_output=True,check=True)
  prepared=json.loads(r.stdout)
  return [decide(v,model) for v in prepared] if isinstance(prepared,list) else decide(prepared,model)
 if args.jsonl:
  for line in sys.stdin:
   if line.strip():print(json.dumps(batch(json.loads(line)),ensure_ascii=False),flush=True)
 else:print(json.dumps(batch(json.load(sys.stdin)),ensure_ascii=False,indent=2))
if __name__=='__main__':main()
