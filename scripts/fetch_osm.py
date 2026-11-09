#!/usr/bin/env python3
"""Download a genuine OSM extract and compile the Kyoto station road network.
No third-party Python packages; TLS/proxy settings remain inherited.
"""
import argparse
import datetime
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

BOUNDS = {'south': 34.975, 'west': 135.74, 'north': 35.005, 'east': 135.78}

def compile_osm(raw):
    root = ET.fromstring(raw)
    if root.tag != 'osm':
        raise ValueError('The response is not OpenStreetMap XML')
    nodes, ways, areas = {}, [], []
    for element in root:
        tags = {t.attrib['k']: t.attrib['v'] for t in element.findall('tag')}
        if element.tag == 'node':
            nodes[int(element.attrib['id'])] = {'id': int(element.attrib['id']), 'lat': float(element.attrib['lat']), 'lon': float(element.attrib['lon']), 'tags': tags}
        elif element.tag == 'way':
            way = {'id': int(element.attrib['id']), 'nodes': [int(n.attrib['ref']) for n in element.findall('nd')], 'tags': tags}
            areas.append(way)
            if tags.get('highway'):
                ways.append(way)
    if not nodes or not ways:
        raise ValueError('No road network in OSM response')
    places, signs, context = [], [], []
    def add_place(identifier, lat, lon, tags):
        name = tags.get('name:ja') or tags.get('name')
        if not name and tags.get('tourism') == 'information':
            name = {'board': '案内看板', 'map': '案内地図', 'guidepost': '案内標柱'}.get(tags.get('information'))
        if name and BOUNDS['south'] <= lat <= BOUNDS['north'] and BOUNDS['west'] <= lon <= BOUNDS['east']:
            places.append({'id': identifier, 'lat': lat, 'lon': lon, 'name': name, 'tags': tags})
    for node in nodes.values():
        t = node['tags']
        add_place('n' + str(node['id']), node['lat'], node['lon'], t)
        if any(k in t for k in ['traffic_sign', 'traffic_sign:forward', 'traffic_sign:backward']) or t.get('highway') in ['stop', 'give_way', 'traffic_signals']:
            signs.append(node)
    for way in areas:
        points = [nodes[n] for n in way['nodes'] if n in nodes]
        if not points:
            continue
        t = way['tags']
        if not t.get('highway'):
            add_place('w' + str(way['id']), sum(p['lat'] for p in points) / len(points), sum(p['lon'] for p in points) / len(points), t)
        if t.get('leisure') == 'park' or t.get('natural') == 'water' or t.get('waterway'):
            context.append({'id': way['id'], 'tags': t, 'points': [[p['lat'], p['lon']] for p in points]})
    return {'version': 2, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'bounds': BOUNDS, 'attribution': '© OpenStreetMap contributors', 'source': 'https://api.openstreetmap.org/api/0.6/map', 'nodes': list(nodes.values()), 'ways': ways, 'places': places, 'signs': signs, 'context': context}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, help='Use a locally downloaded official OSM XML extract')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'site/data/kyoto-network.js')
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        bbox = ','.join(str(BOUNDS[k]) for k in ['west', 'south', 'east', 'north'])
        request = urllib.request.Request('https://api.openstreetmap.org/api/0.6/map?bbox=' + bbox, headers={'User-Agent': 'kyoto-koma-map/1.0 (local development data download)'})
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read()
    data = compile_osm(raw)
    # Validate before replacing any previous usable dataset.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text('window.KYOTO_NETWORK = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f"Saved {len(data['nodes'])} nodes, {len(data['ways'])} roads, {len(data['places'])} places to {args.output}")

if __name__ == '__main__':
    main()
