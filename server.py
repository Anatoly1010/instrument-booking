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
CREATE TABLE IF NOT EXISTS booking_instruments (
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id),
    PRIMARY KEY (booking_id, instrument_id)
);
CREATE INDEX IF NOT EXISTS bookings_by_instrument ON booking_instruments(instrument_id, booking_id);
CREATE TABLE IF NOT EXISTS labs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    lab_id INTEGER NOT NULL REFERENCES labs(id),
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    UNIQUE (lab_id, name_key)
);
CREATE TABLE IF NOT EXISTS booking_employees (
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    PRIMARY KEY (booking_id, employee_id)
);
"""
MAX_ID = 2**63 - 1


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
    rows = db.execute(
        """SELECT b.*,
             (SELECT group_concat(instrument_id) FROM booking_instruments WHERE booking_id = b.id) AS instruments,
             (SELECT group_concat(employee_id) FROM booking_employees WHERE booking_id = b.id) AS employees
           FROM bookings AS b WHERE start < ? AND end > ? ORDER BY start, id""",
        (f"{last}T00:00", f"{first}T00:00"),
    )
    result = []
    for row in rows:
        entry = dict(row)
        entry["instrument_ids"] = [int(item) for item in entry.pop("instruments").split(",")]
        employees = entry.pop("employees")
        entry["employee_ids"] = [int(item) for item in employees.split(",")] if employees else []
        result.append(entry)
    return result


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


def rename_lab(db, data, lab_id):
    name = clean_text(data, "name", "Название лаборатории", 100)
    try:
        row = db.execute(
            "UPDATE labs SET name = ?, name_key = ? WHERE id = ? RETURNING id, name",
            (name, name.casefold(), lab_id),
        ).fetchone()
    except sqlite3.IntegrityError:
        raise ApiError(409, "Лаборатория с таким названием уже есть.") from None
    if row is None:
        raise ApiError(404, "Лаборатория не найдена.")
    return dict(row)


def valid_id(value):
    return type(value) is int and 1 <= value <= MAX_ID


def save_employee(db, data, employee_id=None):
    lab_id = data.get("lab_id")
    if not valid_id(lab_id) or not db.execute("SELECT 1 FROM labs WHERE id = ?", (lab_id,)).fetchone():
        raise ApiError(404, "Лаборатория не найдена.")
    name = clean_text(data, "name", "Имя сотрудника", 100)
    values = (lab_id, name, name.casefold())
    try:
        if employee_id is None:
            row = db.execute(
                "INSERT INTO employees(lab_id, name, name_key) VALUES (?, ?, ?) RETURNING id, lab_id, name",
                values,
            ).fetchone()
        else:
            row = db.execute(
                "UPDATE employees SET lab_id = ?, name = ?, name_key = ? WHERE id = ? RETURNING id, lab_id, name",
                (*values, employee_id),
            ).fetchone()
    except sqlite3.IntegrityError:
        raise ApiError(409, "В этой лаборатории уже есть сотрудник с таким именем.") from None
    if row is None:
        raise ApiError(404, "Сотрудник не найден.")
    return dict(row)


def selected_ids(value, message):
    if not isinstance(value, list) or not all(valid_id(item) for item in value):
        raise ApiError(400, message)
    return list(dict.fromkeys(value))


def placeholders(values):
    return ", ".join("?" for _ in values)


def save_booking(db, data, booking_id=None):
    instrument_ids = selected_ids(data.get("instrument_ids", [data.get("instrument_id")]), "Выберите приборы.")
    if not instrument_ids:
        raise ApiError(400, "Выберите хотя бы один прибор.")
    employee_ids = selected_ids(data.get("employee_ids", []), "Проверьте список участников.")
    start = booking_time(data, "start", "Начало")
    end = booking_time(data, "end", "Окончание")
    if end <= start:
        raise ApiError(400, "Окончание должно быть позже начала.")
    person = clean_text(data, "person", "Участники вручную", 100, required=False)
    if not person and not employee_ids:
        raise ApiError(400, "Выберите сотрудников или укажите участников вручную.")
    comment = clean_text(data, "comment", "Комментарий", 1000, required=False)

    # Hold SQLite's write lock across the overlap check and the write.
    db.execute("BEGIN IMMEDIATE")
    if booking_id is not None and not db.execute(
        "SELECT 1 FROM bookings WHERE id = ?", (booking_id,),
    ).fetchone():
        raise ApiError(404, "Эта бронь уже удалена.")
    slots = placeholders(instrument_ids)
    count = db.execute(f"SELECT COUNT(*) FROM instruments WHERE id IN ({slots})", instrument_ids).fetchone()[0]
    if count != len(instrument_ids):
        raise ApiError(404, "Один из выбранных приборов не найден.")
    if employee_ids:
        count = db.execute(
            f"SELECT COUNT(*) FROM employees WHERE id IN ({placeholders(employee_ids)})", employee_ids,
        ).fetchone()[0]
        if count != len(employee_ids):
            raise ApiError(404, "Один из выбранных сотрудников не найден.")
    conflicts = db.execute(
        f"""SELECT DISTINCT i.name FROM booking_instruments AS x
            JOIN bookings AS b ON b.id = x.booking_id
            JOIN instruments AS i ON i.id = x.instrument_id
            WHERE x.instrument_id IN ({slots}) AND b.start < ? AND b.end > ? AND b.id != ?
            ORDER BY i.name""",
        (*instrument_ids, end, start, booking_id or 0),
    ).fetchall()
    if conflicts:
        names = ", ".join(f"«{row['name']}»" for row in conflicts)
        raise ApiError(409, f"На это время уже есть бронь для {names}.")

    values = instrument_ids[0], start, end, person, comment
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
        db.execute("DELETE FROM booking_instruments WHERE booking_id = ?", (booking_id,))
        db.execute("DELETE FROM booking_employees WHERE booking_id = ?", (booking_id,))
    booking_id = row["id"]
    db.executemany(
        "INSERT INTO booking_instruments VALUES (?, ?)", ((booking_id, item) for item in instrument_ids),
    )
    db.executemany(
        "INSERT INTO booking_employees VALUES (?, ?)", ((booking_id, item) for item in employee_ids),
    )
    return dict(row, instrument_ids=instrument_ids, employee_ids=employee_ids)


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
        if path == "/api/directory" and method == "GET":
            return 200, {
                "labs": [dict(row) for row in db.execute("SELECT id, name FROM labs ORDER BY id")],
                "employees": [dict(row) for row in db.execute("SELECT id, lab_id, name FROM employees ORDER BY name_key, id")],
            }
        if path == "/api/employees" and method == "POST":
            return 201, save_employee(db, self.read_json())
        if path == "/api/bookings":
            if method == "GET":
                return 200, in_period(db, parse_qs(url.query))
            if method == "POST":
                return 201, save_booking(db, self.read_json())
        match = re.fullmatch(r"/api/(instruments|labs|employees|bookings)/([1-9][0-9]{0,18})", path)
        if match and (item_id := int(match[2])) <= MAX_ID:
            if method == "PUT":
                save = {"instruments": save_instrument, "labs": rename_lab, "employees": save_employee, "bookings": save_booking}
                return 200, save[match[1]](db, self.read_json(), item_id)
            if method == "DELETE" and match[1] == "bookings":
                if self.headers.get("Content-Type") != "application/json":
                    raise ApiError(415, "Ожидается запрос JSON.")
                if db.execute("DELETE FROM bookings WHERE id = ?", (item_id,)).rowcount == 0:
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
    with closing(sqlite3.connect(db_path)) as db, db:
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript("BEGIN IMMEDIATE;\n" + SCHEMA)
        db.execute("INSERT OR IGNORE INTO booking_instruments SELECT id, instrument_id FROM bookings")
        labs = [(number, f"Лаборатория {number}") for number in range(1, 5)]
        db.executemany(
            "INSERT OR IGNORE INTO labs(id, name, name_key) VALUES (?, ?, ?)",
            ((lab_id, name, name.casefold()) for lab_id, name in labs),
        )
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
