"""Record the actual Python environment, then execute the captured task source."""
import importlib.metadata
import json
import platform
import runpy
import sys
from pathlib import Path

script = Path(sys.argv[1]).resolve()
config = script.parent.parent / 'config'
packages = sorted(({'name': item.metadata['Name'], 'version': item.version} for item in importlib.metadata.distributions()
                   if item.metadata.get('Name')), key=lambda item: item['name'].lower())
(config / 'environment.json').write_text(json.dumps({'python': platform.python_version(), 'executable': sys.executable,
    'platform': platform.platform(), 'packages': packages}, ensure_ascii=False, indent=2), encoding='utf-8')
(config / 'requirements.txt').write_text(''.join(f"{item['name']}=={item['version']}\n" for item in packages), encoding='utf-8')
sys.path.insert(0, str(script.parent))
runpy.run_path(str(script), run_name='__main__')
