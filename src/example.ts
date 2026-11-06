import type { Repository } from "./types";

const files: Record<string, string> = {
  "README.md": `# Fieldnotes

A small, well-organized API for keeping a personal reading list.

Fieldnotes is the example repository included with GitMap. Open a file in the explorer, or switch to the map to see how the project is organized.

## Project structure

The application uses Flask's application factory pattern. Routes handle HTTP requests, services contain the business logic, and a small SQLite repository keeps data access separate.

\`\`\`text
fieldnotes/
├── app/             Application code
│   ├── routes/      HTTP endpoints
│   ├── services/    Reading-list operations
│   └── models/      SQLite persistence
├── tests/           API and service tests
└── run.py           Development entry point
\`\`\`

## Run locally

\`\`\`bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
flask --app run run
\`\`\`

## Endpoints

- \`GET /api/books\` — list saved books
- \`POST /api/books\` — add a book to the list
- \`PATCH /api/books/:id\` — update reading status
- \`DELETE /api/books/:id\` — remove a book

## Tests

Run \`pytest\` to check validation, persistence, and the HTTP endpoints. Tests use an in-memory database.

## A note on the example

This is a bundled sample, not a connected GitHub repository. Import a public repository or upload a ZIP to explore your own code.
`,
  "app/__init__.py": `"""Create and configure the Fieldnotes application."""

from flask import Flask
from app.config import Config
from app.models.database import init_database
from app.routes.books import books
from app.routes.health import health


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)

    init_database(app)
    app.register_blueprint(books, url_prefix="/api/books")
    app.register_blueprint(health, url_prefix="/api")

    return app
`,
  "app/config.py": `"""Environment-based configuration for local development."""

import os


class Config:
    DATABASE = os.environ.get("DATABASE", "fieldnotes.sqlite3")
    TESTING = False
    JSON_SORT_KEYS = False


class TestConfig(Config):
    DATABASE = ":memory:"
    TESTING = True
`,
  "app/models/database.py": `"""SQLite connection lifecycle and schema initialization."""

import sqlite3
from flask import current_app, g


def get_database():
    if "database" not in g:
        g.database = sqlite3.connect(current_app.config["DATABASE"])
        g.database.row_factory = sqlite3.Row
    return g.database


def close_database(error=None):
    database = g.pop("database", None)
    if database is not None:
        database.close()


def init_database(app):
    app.teardown_appcontext(close_database)
    with app.app_context():
        database = get_database()
        database.execute("""
            CREATE TABLE IF NOT EXISTS books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'to-read'
            )
        """)
        database.commit()
`,
  "app/models/book.py": `"""Persist books using parameterized SQLite queries."""

from app.models.database import get_database


class BookRepository:
    def list_all(self):
        rows = get_database().execute(
            "SELECT * FROM books ORDER BY id DESC"
        ).fetchall()
        return [dict(row) for row in rows]

    def find(self, book_id):
        row = get_database().execute(
            "SELECT * FROM books WHERE id = ?", (book_id,)
        ).fetchone()
        return dict(row) if row else None

    def create(self, title, author):
        database = get_database()
        cursor = database.execute(
            "INSERT INTO books (title, author) VALUES (?, ?)",
            (title, author),
        )
        database.commit()
        return self.find(cursor.lastrowid)

    def update_status(self, book_id, status):
        database = get_database()
        database.execute(
            "UPDATE books SET status = ? WHERE id = ?",
            (status, book_id),
        )
        database.commit()
        return self.find(book_id)

    def delete(self, book_id):
        database = get_database()
        database.execute("DELETE FROM books WHERE id = ?", (book_id,))
        database.commit()
`,
  "app/routes/books.py": `"""HTTP endpoints for the reading list."""

from flask import Blueprint, jsonify, request
from app.services.books import BookService

books = Blueprint("books", __name__)
service = BookService()


@books.get("")
def list_books():
    return jsonify(service.list_books())


@books.post("")
def add_book():
    data = request.get_json(silent=True) or {}
    try:
        book = service.add_book(data.get("title"), data.get("author"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return jsonify(book), 201


@books.patch("/<int:book_id>")
def update_book(book_id):
    data = request.get_json(silent=True) or {}
    try:
        book = service.update_status(book_id, data.get("status"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    if book is None:
        return jsonify({"error": "Book not found"}), 404
    return jsonify(book)


@books.delete("/<int:book_id>")
def delete_book(book_id):
    service.delete_book(book_id)
    return "", 204
`,
  "app/routes/health.py": `"""Basic health endpoint for deployment checks."""

from flask import Blueprint, jsonify

health = Blueprint("health", __name__)


@health.get("/health")
def health_check():
    return jsonify({"status": "ok", "service": "fieldnotes"})
`,
  "app/services/books.py": `"""Validate reading-list operations before writing to the database."""

from app.models.book import BookRepository

VALID_STATUSES = {"to-read", "reading", "finished"}


class BookService:
    def __init__(self, repository=None):
        self.repository = repository or BookRepository()

    def list_books(self):
        return self.repository.list_all()

    def add_book(self, title, author):
        if not isinstance(title, str) or not title.strip():
            raise ValueError("A title is required")
        if not isinstance(author, str) or not author.strip():
            raise ValueError("An author is required")
        return self.repository.create(title.strip(), author.strip())

    def update_status(self, book_id, status):
        if status not in VALID_STATUSES:
            raise ValueError("Choose to-read, reading, or finished")
        return self.repository.update_status(book_id, status)

    def delete_book(self, book_id):
        self.repository.delete(book_id)
`,
  "tests/conftest.py": `"""A clean application fixture for each test."""

import pytest
from app import create_app


@pytest.fixture
def client(tmp_path):
    class TestConfig:
        TESTING = True
        DATABASE = str(tmp_path / "test.sqlite3")

    app = create_app(TestConfig)
    with app.test_client() as client:
        yield client
`,
  "tests/test_books.py": `"""Check successful requests and invalid input."""


def test_empty_reading_list(client):
    response = client.get("/api/books")
    assert response.status_code == 200
    assert response.json == []


def test_create_book(client):
    response = client.post("/api/books", json={
        "title": "The Pragmatic Programmer", "author": "Hunt & Thomas"
    })
    assert response.status_code == 201
    assert response.json["status"] == "to-read"


def test_title_required(client):
    response = client.post("/api/books", json={"author": "Someone"})
    assert response.status_code == 400


def test_reject_invalid_status(client):
    response = client.patch("/api/books/1", json={"status": "unknown"})
    assert response.status_code == 400
`,
  "run.py": `"""Development entry point."""

from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
`,
  "requirements.txt": `Flask>=3.1,<4\npytest>=8,<9\ngunicorn>=23,<24\n`,
  "pyproject.toml": `[project]\nname = "fieldnotes"\nversion = "0.1.0"\ndescription = "A small reading-list API"\nrequires-python = ">=3.11"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`,
  ".gitignore": `.venv/\n__pycache__/\n*.sqlite3\n.pytest_cache/\n.env\n`,
  LICENSE: `MIT License\n\nCopyright (c) 2026 Fieldnotes contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, subject to the conditions of the MIT License.\n`,
  ".github/workflows/tests.yml": `name: Tests\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n      - run: pip install -r requirements.txt\n      - run: pytest\n`,
  "docs/architecture.md": `# Architecture\n\nHTTP requests enter through a Flask blueprint. The BookService validates input before delegating to the BookRepository. SQLite connections are scoped to the request and closed by the application teardown handler.\n\n## Request lifecycle\n\n1. Flask matches a route.\n2. The route reads JSON input.\n3. The service checks domain rules.\n4. The repository executes a parameterized query.\n5. The route returns JSON.\n`,
  Dockerfile: `FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["gunicorn", "--bind", "0.0.0.0:8000", "run:app"]\n`,
};

export const exampleRepository: Repository = {
  id: "example-fieldnotes",
  name: "fieldnotes",
  owner: "examples",
  branch: "main",
  description: "A small Flask API for keeping a personal reading list.",
  source: "example",
  entries: Object.entries(files).map(([path, content]) => ({
    path,
    content,
    type: "file",
    size: new TextEncoder().encode(content).length,
  })),
};
