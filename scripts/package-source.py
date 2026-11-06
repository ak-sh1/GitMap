"""Create the downloadable source archive without dependencies or runtime data."""

from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
excluded = {'node_modules', 'dist', '.git', '.venv', '__pycache__',
            '.pytest_cache', '.openai'}
output = root / 'public' / 'gitmap-source.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if not path.is_file() or any(part in excluded for part in relative.parts):
            continue
        if path in (output, root / 'public' / 'gitwiz-source.zip') or path.name == '.env' or path.suffix == '.pyc':
            continue
        archive.write(path, Path('gitmap') / relative)
print(f'Source archive: {output} ({output.stat().st_size} bytes)')
