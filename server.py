"""Local equipment booking server. Uses only the Python standard library."""

import argparse
from contextlib import closing
from datetime import date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parent
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
SCHEMA = """
CREATE TABLE IF NOT EXISTS instruments (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id),
    start TEXT NOT NULL,
    end TEXT NOT NULL CHECK (end > start),
    person TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS booking_intervals ON bookings(instrument_id, start, end);
"""


class ApiError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status


def clean_text(data, field, label, limit, required=True):
    value = data.get(field, "")
    if not isinstance(value, str):
        raise ApiError(400, f"Поле «{label}» должно быть текстом.")
    value = value.strip()
    if required and not value:
        raise ApiError(400, f"Заполните поле «{label}».")
    if len(value) > limit:
        raise ApiError(400, f"Поле «{label}» вмещает до {limit} символов.")
    return value


def booking_time(data, field, label):
    value = clean_text(data, field, label, 16)
    if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}", value):
        try:
            datetime.fromisoformat(value)
            return value
        except ValueError:
            pass
    raise ApiError(400, f"Укажите дату и время в поле «{label}».")


def in_period(db, params):
    try:
        first = date.fromisoformat(params["from"][0])
        last = date.fromisoformat(params["to"][0])
        if not 0 < (last - first).days <= 31:
            raise ValueError
    except (KeyError, ValueError):
        raise ApiError(400, "Укажите диапазон дат до 31 дня.") from None
    return db.execute(
        "SELECT * FROM bookings WHERE start < ? AND end > ? ORDER BY start, id",
        (f"{last}T00:00", f"{first}T00:00"),
    ).fetchall()


def save_instrument(db, data, instrument_id=None):
    name = clean_text(data, "name", "Название прибора", 100)
    values = (name, name.casefold())
    try:
        if instrument_id is None:
            row = db.execute(
                "INSERT INTO instruments(name, name_key) VALUES (?, ?) RETURNING id, name",
                values,
            ).fetchone()
        else:
            row = db.execute(
                "UPDATE instruments SET name = ?, name_key = ? WHERE id = ? RETURNING id, name",
                (*values, instrument_id),
            ).fetchone()
    except sqlite3.IntegrityError:
        raise ApiError(409, "Прибор с таким названием уже есть.") from None
    if row is None:
        raise ApiError(404, "Прибор не найден.")
    return dict(row)


def save_booking(db, data, booking_id=None):
    instrument_id = data.get("instrument_id")
    if type(instrument_id) is not int or not 1 <= instrument_id <= 2**63 - 1:
        raise ApiError(400, "Выберите прибор.")
    start = booking_time(data, "start", "Начало")
    end = booking_time(data, "end", "Окончание")
    if end <= start:
        raise ApiError(400, "Окончание должно быть позже начала.")
    person = clean_text(data, "person", "Кто бронирует", 100)
    comment = clean_text(data, "comment", "Комментарий", 1000, required=False)

    # Hold SQLite's write lock across the overlap check and the write.
    db.execute("BEGIN IMMEDIATE")
    if booking_id is not None and not db.execute(
        "SELECT 1 FROM bookings WHERE id = ?", (booking_id,),
    ).fetchone():
        raise ApiError(404, "Эта бронь уже удалена.")
    if not db.execute("SELECT 1 FROM instruments WHERE id = ?", (instrument_id,)).fetchone():
        raise ApiError(404, "Прибор не найден.")
    conflict = db.execute(
        """SELECT 1 FROM bookings
           WHERE instrument_id = ? AND start < ? AND end > ? AND id != ? LIMIT 1""",
        (instrument_id, end, start, booking_id or 0),
    ).fetchone()
    if conflict:
        raise ApiError(409, "Прибор уже забронирован на это время. Выберите другой интервал.")

    values = instrument_id, start, end, person, comment
    if booking_id is None:
        row = db.execute(
            """INSERT INTO bookings(instrument_id, start, end, person, comment)
               VALUES (?, ?, ?, ?, ?) RETURNING *""",
            values,
        ).fetchone()
    else:
        row = db.execute(
            """UPDATE bookings SET instrument_id = ?, start = ?, end = ?, person = ?, comment = ?
               WHERE id = ? RETURNING *""",
            (*values, booking_id),
        ).fetchone()
    return dict(row)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.dispatch()

    do_POST = do_PUT = do_DELETE = do_GET

    def dispatch(self):
        url = urlsplit(self.path)
        try:
            if self.command == "GET" and url.path in ASSETS:
                filename, content_type = ASSETS[url.path]
                self.respond(200, (ROOT / "static" / filename).read_bytes(), content_type)
                return

            if not url.path.startswith("/api/"):
                self.send_error(404)
                return

            with closing(sqlite3.connect(self.server.db_path, timeout=5)) as db, db:
                db.row_factory = sqlite3.Row
                db.execute("PRAGMA foreign_keys = ON")
                status, payload = self.api(db, url)
            self.json_response(status, payload)
        except ApiError as error:
            self.json_response(error.status, {"error": str(error)})
        except sqlite3.OperationalError as error:
            self.log_error("Database error: %s", error)
            self.json_response(503, {"error": "База данных недоступна. Попробуйте ещё раз."})

    def api(self, db, url):
        method, path = self.command, url.path
        if path == "/api/instruments":
            if method == "GET":
                rows = db.execute("SELECT id, name FROM instruments ORDER BY id")
                return 200, [dict(row) for row in rows]
            if method == "POST":
                return 201, save_instrument(db, self.read_json())
        if method == "PUT" and (match := re.fullmatch(r"/api/instruments/([1-9][0-9]{0,18})", path)):
            instrument_id = int(match[1])
            if instrument_id <= 2**63 - 1:
                return 200, save_instrument(db, self.read_json(), instrument_id)
        if path == "/api/bookings":
            if method == "GET":
                return 200, [dict(row) for row in in_period(db, parse_qs(url.query))]
            if method == "POST":
                return 201, save_booking(db, self.read_json())
        match = re.fullmatch(r"/api/bookings/([1-9][0-9]{0,18})", path)
        if match and (booking_id := int(match[1])) <= 2**63 - 1:
            if method == "PUT":
                return 200, save_booking(db, self.read_json(), booking_id)
            if method == "DELETE":
                if self.headers.get("Content-Type") != "application/json":
                    raise ApiError(415, "Ожидается запрос JSON.")
                if db.execute("DELETE FROM bookings WHERE id = ?", (booking_id,)).rowcount == 0:
                    raise ApiError(404, "Эта бронь уже удалена.")
                return HTTPStatus.NO_CONTENT, None
        raise ApiError(404, "Запрошенный адрес не найден.")

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise ApiError(415, "Ожидается запрос JSON.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 16_384:
                raise ValueError
            value = json.loads(self.rfile.read(length))
            if isinstance(value, dict):
                return value
        except (ValueError, RecursionError):
            pass
        raise ApiError(400, "Не удалось прочитать данные запроса.")

    def json_response(self, status, payload):
        body = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        self.respond(status, body, "application/json; charset=utf-8")

    def respond(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if status != HTTPStatus.NO_CONTENT:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def create_server(port, db_path):
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as db:
        db.executescript(SCHEMA)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.db_path = db_path
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "schedule.sqlite3")
    args = parser.parse_args()
    with create_server(args.port, args.db) as server:
        print(f"Local URL: http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
