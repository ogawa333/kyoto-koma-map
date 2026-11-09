#!/usr/bin/env python3
"""Download a genuine OSM extract and compile the Kyoto station road network.
No third-party Python packages; TLS/proxy settings remain inherited.
"""
import argparse
import datetime
import json
from pathlib import Path
import urllib.request
import urllib.error
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
    return {'version': 2, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'bounds': BOUNDS, 'attribution': '© OpenStreetMap contributors', 'source': 'https://api.openstreetmap.org/api/0.6/map', 'nodes': [nodes[i] for i in sorted({n for way in ways for n in way['nodes']} | {p['id'] for p in signs}) if i in nodes], 'ways': ways, 'places': places, 'signs': signs, 'context': context}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, help='Use a locally downloaded official OSM XML extract')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'site/data/kyoto-network.js')
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        # Dense Kyoto exceeds the map API's 50,000-node cap for a single box.
        # Download smaller official extracts and deduplicate complete objects.
        combined = ET.Element('osm', version='0.6')
        objects = {}
        def download_tile(west, south, east, north, depth=0):
            bbox = ','.join(map(str, [west, south, east, north]))
            print('Downloading OSM tile ' + bbox, flush=True)
            request = urllib.request.Request('https://api.openstreetmap.org/api/0.6/map?bbox=' + bbox, headers={'User-Agent': 'kyoto-koma-map/1.0 (local development data download)'})
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    tile = ET.fromstring(response.read())
            except urllib.error.HTTPError as error:
                body = error.read().decode('utf-8', errors='replace')
                if error.code != 400 or 'too many nodes' not in body or depth >= 3:
                    raise ValueError(f'OSM API returned {error.code}: {body[:300]}') from error
                mid_lat, mid_lon = (south + north) / 2, (west + east) / 2
                for low, high in [(south, mid_lat), (mid_lat, north)]:
                    for left, right in [(west, mid_lon), (mid_lon, east)]:
                        download_tile(left, low, right, high, depth + 1)
                return
            if tile.tag != 'osm':
                raise ValueError('The response is not OpenStreetMap XML')
            for element in tile:
                if element.tag in ['node', 'way', 'relation']:
                    key = (element.tag, element.attrib['id'])
                    existing = objects.get(key)
                    if existing is None or int(element.get('version', 0)) >= int(existing.get('version', 0)):
                        objects[key] = element
        # Begin with small tiles in this unusually dense urban area.
        for row in range(4):
            south = BOUNDS['south'] + (BOUNDS['north'] - BOUNDS['south']) * row / 4
            north = BOUNDS['south'] + (BOUNDS['north'] - BOUNDS['south']) * (row + 1) / 4
            for column in range(4):
                west = BOUNDS['west'] + (BOUNDS['east'] - BOUNDS['west']) * column / 4
                east = BOUNDS['west'] + (BOUNDS['east'] - BOUNDS['west']) * (column + 1) / 4
                download_tile(west, south, east, north)
        combined.extend(objects.values())
        raw = ET.tostring(combined)
    data = compile_osm(raw)
    # Validate before replacing any previous usable dataset.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text('window.KYOTO_NETWORK = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f"Saved {len(data['nodes'])} nodes, {len(data['ways'])} roads, {len(data['places'])} places to {args.output}")

if __name__ == '__main__':
    main()
