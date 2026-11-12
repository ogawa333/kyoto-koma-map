#!/usr/bin/env node
// Read local evaluation exports only. Reuse the app's validation and geometry.
const fs = require('node:fs');
const crypto = require('node:crypto');
const evaluation = require('../site/evaluation-core.js');
const routing = require('../site/routing.js');
const exclusions = require('../config/junction-evaluation-exclusions.json').entries;
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function prepare(files, evaluatorId) {
  const rows = new Map(), excluded = {unanswered: 0, uncertain: 0, unblinded: 0, invalidGeometry: 0, duplicates: 0, manualExclusions: 0};
  const datasets = new Set();
  let ruleVersion = null;
  for (const file of files) {
    const d = evaluation.validateDataset(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (ruleVersion && ruleVersion !== d.source.ruleVersion) throw Error('異なる基準ルールの評価セットは混ぜられません。');
    ruleVersion = d.source.ruleVersion;
    datasets.add(d.id);
    const responses = new Map(d.responses.filter(r => r.evaluatorId === evaluatorId).map(r => [r.pairId, r]));
    for (const p of d.pairs) {
      const geometryKey = crypto.createHash('sha256').update(canonical(p.modelInput)).digest('hex');
      if (exclusions.some(e => (e.datasetId === d.id && e.pairId === p.id) || e.geometryKey === geometryKey)) { excluded.manualExclusions++; continue; }
      const r = responses.get(p.id);
      if (!r) { excluded.unanswered++; continue; }
      if (r.ruleViewedAt && Date.parse(r.updatedAt) >= Date.parse(r.ruleViewedAt)) { excluded.unblinded++; continue; }
      if (r.blindAtDecision === false) { excluded.unblinded++; continue; }
      if (r.choice === 'uncertain') { excluded.uncertain++; continue; }
      const signatures = ['candidate', 'target'].map(k => routing.junctionSignature(p.modelInput[k]));
      if (signatures.some(s => !s)) { excluded.invalidGeometry++; continue; }
      // Include absolute geometry in the deduplication key, never as model features.
      const key = crypto.createHash('sha256').update(canonical(p.modelInput)).digest('hex');
      const row = {key, signatures, label: evaluation.CHOICES[r.choice].trainingLabel,
        choice: r.choice, rule: p.rulePrediction, groups: [...p.splitGroups].sort(),
        centers: ['candidate', 'target'].map(k => p.modelInput[k].center),
        references: [{datasetId: d.id, pairId: p.id}]};
      if (rows.has(key)) {
        const old = rows.get(key);
        if (old.label !== row.label || old.choice !== row.choice || old.rule !== row.rule) throw Error('同じ形状ペアの回答または基準ルールが競合しています: ' + p.id);
        old.groups = [...new Set([...old.groups, ...row.groups])].sort();
        old.references.push(...row.references); excluded.duplicates++;
      } else rows.set(key, row);
    }
  }
  return {datasetIds: [...datasets].sort(), evaluatorId, ruleVersion, excluded, rows: [...rows.values()].sort((a,b) => a.key.localeCompare(b.key))};
}
if (require.main === module) {
  try {
    const [, , evaluatorId, ...files] = process.argv;
    if (!evaluatorId || !files.length) throw Error('Usage: node scripts/prepare_evaluations.cjs P001 export.json [...]');
    process.stdout.write(JSON.stringify(prepare(files, evaluatorId)));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = {prepare};
