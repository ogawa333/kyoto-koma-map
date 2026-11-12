import hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'MANIFEST.sha256.json').read_text())
errors=[]
for name,digest in manifest.items():
 p=ROOT/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:errors.append(name)
if errors:raise SystemExit('Checksum mismatch: '+', '.join(errors))
print(f'Checksums OK: {len(manifest)} files')
