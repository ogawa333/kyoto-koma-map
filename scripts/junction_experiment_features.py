"""Experimental, shape-only features. No answers, rules, IDs or coordinates as inputs."""
import math
import numpy as np
from scipy.optimize import linear_sum_assignment
import local_ai

VERSION = 'junction-correspondence-entry-curve-v1'
DEPTHS = (2, 5, 8, 12, 20)


def wrap(x):
    return math.atan2(math.sin(x), math.cos(x))


def matching(a, b):
    """Minimize the largest 8m/20m angle difference, then the total difference."""
    cost = np.asarray([[max(abs(wrap(x-y)) for x, y in zip(u, v)) for v in b] for u in a])
    limits = np.unique(cost)
    low, high = 0, len(limits)-1
    while low < high:
        mid = (low+high)//2
        i, j = linear_sum_assignment(np.where(cost <= limits[mid]+1e-12, cost, 1e6))
        if np.all(cost[i, j] <= limits[mid]+1e-12):
            high = mid
        else:
            low = mid+1
    i, j = linear_sum_assignment(np.where(cost <= limits[low]+1e-12, cost, 1e6))
    return list(zip(i.tolist(), j.tolist())), float(limits[low])


def summary(values):
    a = np.asarray(values, dtype=float)
    return [float(np.min(a)), float(np.mean(a)), float(np.max(a)), float(np.std(a))] if len(a) else [0.]*4


def branches(frame, signature, entry):
    """Canonicalize branch ordering without including an absolute position."""
    def key(i):
        center = frame['center']
        shape = tuple((round(p['lat']-center['lat'], 10), round(p['lon']-center['lon'], 10)) for p in frame['branches'][i])
        return tuple(signature[i]), shape
    order = sorted(range(len(signature)), key=key)
    return [signature[i] for i in order], [frame['branches'][i] for i in order], order.index(entry) if entry in order else None


def geometry(frame, paths):
    result = []
    center = frame['center']
    for path in paths:
        lengths = [local_ai.distance(a, b) for a, b in zip(path, path[1:])]
        total = sum(lengths)
        angles, radii = [], []
        for depth in DEPTHS:
            remaining = min(depth, total)
            point = path[-1]
            for a, b, meters in zip(path, path[1:], lengths):
                if meters and remaining <= meters:
                    fraction = remaining/meters
                    point = {k:a[k]+(b[k]-a[k])*fraction for k in ('lat', 'lon')}
                    break
                remaining -= meters
            east = (point['lon']-center['lon'])*math.cos(math.radians((point['lat']+center['lat'])/2))
            north = point['lat']-center['lat']
            angles.append(wrap(math.atan2(east, north)-frame['heading']))
            radii.append(math.hypot((point['lon']-center['lon'])*111320*math.cos(math.radians(center['lat'])), north*111320))
        result.append(dict(length=total, angles=angles, radii=radii))
    return result


def vectors(row):
    """Return successive additive stages A, B, C with stable feature order."""
    base = local_ai.features(row['signatures'])
    frames = [row['pair']['modelInput'][k] for k in ('candidate', 'target')]
    signatures, paths, entries = [], [], []
    for frame, signature, entry in zip(frames, row['signatures'], [row.get('entryIndex'), row.get('targetEntryIndex')]):
        s, p, e = branches(frame, signature, entry)
        signatures.append(s); paths.append(p); entries.append(e)
    a, b = signatures
    pairs, bottleneck = matching(a, b)
    pair_features = [float(len(a)==len(b)), abs(len(a)-len(b)), math.degrees(bottleneck)]
    for depth in range(2):
        delta = [wrap(a[i][depth]-b[j][depth]) for i, j in pairs]
        pair_features += summary([math.degrees(abs(d)) for d in delta])
        pair_features += [sum(math.sin(d) for d in delta)/len(delta), sum(math.cos(d) for d in delta)/len(delta)]
        for sign in (a, b):
            angles = sorted(s[depth] for s in sign)
            gaps = [(angles[(i+1)%len(angles)]-v) % (2*math.pi) for i, v in enumerate(angles)]
            pair_features += summary([math.degrees(x) for x in gaps])
        quadrants = lambda s: np.bincount([int(((v[depth]+math.pi/4) % (2*math.pi))/(math.pi/2)) for v in s], minlength=4)
        pair_features += np.abs(quadrants(a)-quadrants(b)).tolist()
    relational = base+pair_features
    ga, gb = [geometry(frame, path) for frame, path in zip(frames, paths)]
    detail = []
    for signature, geo, entry in zip(signatures, [ga, gb], entries):
        detail += summary([g['length'] for g in geo])
        detail += [sum(g['length']>=depth for g in geo)/len(geo) for depth in DEPTHS]
        for k in range(len(DEPTHS)-1):
            bends = [math.degrees(wrap(g['angles'][k+1]-g['angles'][k])) for g in geo]
            detail += summary(bends)+summary([abs(x) for x in bends])
        detail += [float(entry is None)]
        incoming = geo[entry] if entry is not None else None
        detail += [v for angle in (incoming['angles'] if incoming else [0.]*5) for v in (math.sin(angle), math.cos(angle))]
        detail += [incoming['length'] if incoming else 0.]
        for depth in range(2):
            gaps = [wrap(s[depth]-signature[entry][depth]) for i, s in enumerate(signature) if i!=entry] if entry is not None else []
            detail += summary([math.degrees(x) for x in gaps])
    for k in range(len(DEPTHS)):
        delta = [abs(wrap(ga[i]['angles'][k]-gb[j]['angles'][k])) for i, j in pairs]
        detail += summary([math.degrees(x) for x in delta])
        detail += summary([2*min(ga[i]['radii'][k], gb[j]['radii'][k])*math.sin(d/2)*2.6 for (i,j),d in zip(pairs, delta)])
    # Anchor the comparison to the actual arrival branch, never the candidate exit.
    ea, eb = entries
    if ea is not None and eb is not None:
        rest_a = [x for i,x in enumerate(a) if i!=ea];rest_b = [x for i,x in enumerate(b) if i!=eb]
        _, remaining = matching(rest_a, rest_b)
        anchored = max(remaining, max(abs(wrap(x-y)) for x,y in zip(a[ea],b[eb])))
        detail += [0., math.degrees(anchored)]
    else:
        detail += [1., 0.]
    detailed = relational+detail
    for vector in (base, relational, detailed):
        if not all(math.isfinite(x) for x in vector):
            raise ValueError('Non-finite experiment feature')
    return {'A':base, 'B':relational, 'C':detailed, 'D':detailed}
