import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('fetch_osm',Path(__file__).parents[1]/'scripts/fetch_osm.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExtractTest(unittest.TestCase):
    # Synthetic fixture for the parser only; never used as the app's road data.
    XML=b'''<osm><node id="1" lat="34.99" lon="135.75"><tag k="name" v="Test sign"/><tag k="traffic_sign" v="JP:330"/></node><node id="2" lat="34.991" lon="135.75"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="foot" v="no"/></way><way id="4"><nd ref="1"/><nd ref="2"/><tag k="name" v="Test park"/><tag k="leisure" v="park"/></way></osm>'''
    def test_tags_and_sources_are_preserved(self):
        d=module.compile_osm(self.XML)
        self.assertEqual(d['ways'][0]['tags']['foot'],'no')
        self.assertEqual(d['signs'][0]['id'],1)
        self.assertEqual([p['id'] for p in d['places']],['n1','w4'])
        self.assertEqual(len(d['context']),1)
        self.assertEqual(d['bounds']['west'],135.74)
    def test_invalid_or_empty_response_is_rejected(self):
        for raw in [b'<html/>',b'<osm/>']:
            with self.assertRaises(ValueError):module.compile_osm(raw)

if __name__=='__main__':unittest.main()
