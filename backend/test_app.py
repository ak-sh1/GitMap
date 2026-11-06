import base64
import pytest
from backend import app as api


@pytest.fixture
def client():
    return api.create_app({'TESTING': True}).test_client()


@pytest.mark.parametrize('url', [
    'http://localhost/secrets', 'https://github.com.evil.test/org/repo',
    'https://user:password@github.com/org/repo', 'https://github.com:8443/a/b',
    'https://127.0.0.1/a/b', '../repo', '', None,
])
def test_rejects_non_github_targets(client, url):
    assert client.post('/api/repositories', json={'url': url}).status_code == 400


def test_import_pins_snapshot_and_excludes_generated_and_sensitive_files(client, monkeypatch):
    responses = iter([
        {'default_branch': 'main', 'description': 'A test repo'},
        {'commit': {'sha': 'commit123', 'commit': {'tree': {'sha': 'tree456'}}}},
        {'sha': 'tree456', 'tree': [
            {'path': 'src/main.py', 'type': 'blob', 'size': 20},
            {'path': '.env', 'type': 'blob'},
            {'path': 'node_modules/thing.js', 'type': 'blob'},
            {'path': 'src', 'type': 'tree'},
        ]},
    ])
    calls = []
    def github_get(path):
        calls.append(path)
        return next(responses)
    monkeypatch.setattr(api, 'github_get', github_get)
    response = client.post('/api/repositories', json={'url': 'owner/repository'})
    assert response.status_code == 200
    assert calls[1:] == ['/repos/owner/repository/branches/main',
                         '/repos/owner/repository/git/trees/tree456?recursive=1']
    assert response.json['sha'] == 'commit123'
    assert {e['path'] for e in response.json['entries']} == {'src/main.py', 'src'}


def test_file_reads_the_specified_ref(client, monkeypatch):
    calls = []
    def get(path):
        calls.append(path)
        return {'type': 'file', 'size': 12, 'encoding': 'base64',
                'content': base64.b64encode(b'print("ok")').decode()}
    monkeypatch.setattr(api, 'github_get', get)
    response = client.get('/api/file?owner=a&name=b&path=app.py&ref=commit123')
    assert response.status_code == 200
    assert response.json['content'] == 'print("ok")'
    assert 'ref=commit123' in calls[0]


@pytest.mark.parametrize('path', ['../secrets', '.env', 'src/key.pem', '/etc/passwd', 'thing.png'])
def test_file_rejects_unsafe_or_binary_paths(client, path):
    assert client.get('/api/file', query_string={'owner': 'a', 'name': 'b', 'path': path, 'ref': 'main'}).status_code == 400


def test_outline_uses_python_ast(client):
    response = client.post('/api/outline', json={'content': '"""Example."""\nimport os\nclass Book:\n    async def save(self): pass\n'})
    assert response.json['description'] == 'Example.'
    assert response.json['symbols'] == [
        {'name': 'Book', 'kind': 'class', 'line': 3},
        {'name': 'save', 'kind': 'function', 'line': 4}]
    assert response.json['imports'] == ['os']


def test_unknown_origin_cannot_use_local_server(client):
    assert client.post('/api/repositories', headers={'Origin': 'https://unrelated.example'}, json={}).status_code == 403


def test_allowed_origin_preflight(client):
    response = client.options('/api/repositories', headers={'Origin': 'http://localhost:5173'})
    assert response.headers['Access-Control-Allow-Origin'] == 'http://localhost:5173'


def test_request_limit(client):
    assert client.post('/api/repositories', data='x' * 700_000, content_type='application/json').status_code == 413
