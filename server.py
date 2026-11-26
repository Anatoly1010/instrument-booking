"""Local equipment booking server. Uses only the Python standard library."""

import argparse
from collections import deque
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime
from getpass import getpass, GetPassWarning
import hashlib
from http import HTTPStatus
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import IPv4Address, IPv4Interface, IPv4Network
import json
from pathlib import Path
import re
import secrets
import sqlite3
import ssl
from threading import Lock
from time import monotonic
from urllib.parse import parse_qs, urlsplit
import warnings


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
    name_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'lab' CHECK (kind IN ('lab', 'department'))
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
CREATE TABLE IF NOT EXISTS resonators (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS booking_resonators (
    booking_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,
    resonator_id INTEGER NOT NULL REFERENCES resonators(id),
    PRIMARY KEY (booking_id, instrument_id),
    UNIQUE (booking_id, resonator_id),
    FOREIGN KEY (booking_id, instrument_id)
        REFERENCES booking_instruments(booking_id, instrument_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS bookings_by_resonator ON booking_resonators(resonator_id, booking_id);
CREATE TABLE IF NOT EXISTS admin_credentials (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt BLOB NOT NULL,
    password_hash BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    salt BLOB NOT NULL,
    password_hash BLOB NOT NULL,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL
);
"""
MAX_ID = 2**63 - 1
SESSION_LIFETIME = 8 * 60 * 60
PASSWORD_ITERATIONS = 600_000
CATALOGS = {
    "instruments": ("Название прибора", "Прибор с таким названием уже есть.", "Прибор не найден."),
    "resonators": ("Название резонатора", "Резонатор с таким названием уже есть.", "Резонатор не найден."),
}
LAN_NETWORKS = tuple(IPv4Network(block) for block in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


class ApiError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password, salt, PASSWORD_ITERATIONS)


def password_bytes(password, minimum=1):
    if isinstance(password, str) and minimum <= len(password) <= 1024:
        try:
            return password.encode("utf-8")
        except UnicodeEncodeError:
            pass
    return None


def new_user_password(password):
    encoded = password_bytes(password, minimum=5)
    if encoded is None:
        raise ApiError(400, "Введите пароль длиной от 5 до 1024 символов.")
    return encoded


@dataclass(frozen=True)
class Account:
    user_id: int | None = None
    username: str | None = None
    employee_id: int | None = None

    @property
    def is_admin(self):
        return self.user_id is None


class Sessions:
    def __init__(self):
        self.lock = Lock()
        self.sessions = {}
        self.attempts = {action: deque() for action in ("admin", "user", "register", "password")}
        self.dummy_salt = secrets.token_bytes(16)

    def account(self, token, db):
        with self.lock:
            session = self.sessions.get(token)
        if not session or session[0] <= monotonic():
            return None
        _, account, salt = session
        if account.is_admin:
            credentials = admin_credentials(db)
        else:
            credentials = db.execute("SELECT salt, employee_id FROM users WHERE id = ?", (account.user_id,)).fetchone()
        if credentials is None or credentials["salt"] != salt:
            return None
        if not account.is_admin and account.employee_id != credentials["employee_id"]:
            return Account(account.user_id, account.username, credentials["employee_id"])
        return account

    def recent_attempts(self, action, limit, now):
        attempts = self.attempts[action]
        while attempts and now - attempts[0] >= 60:
            attempts.popleft()
        if len(attempts) >= limit:
            raise ApiError(429, "Слишком много попыток. Попробуйте через минуту.")
        return attempts

    def login(self, password, credentials, old_token, *, admin=False):
        message = "Неверный пароль администратора." if admin else "Неверный логин или пароль."
        encoded = password_bytes(password)
        if encoded is None:
            raise ApiError(401, message)
        with self.lock:
            now = monotonic()
            attempts = self.recent_attempts("admin" if admin else "user", 5 if admin else 10, now)
            salt = self.dummy_salt if credentials is None else credentials["salt"]
            candidate = hash_password(encoded, salt)
            if credentials is None or not secrets.compare_digest(candidate, credentials["password_hash"]):
                attempts.append(now)
                raise ApiError(401, message)
            if admin:
                attempts.clear()
                return self.new_session(Account(), old_token, salt)
            account = Account(credentials["id"], credentials["username"], credentials["employee_id"])
            return self.new_session(account, old_token, salt)

    def register(self, db, username, password, old_token):
        salt = secrets.token_bytes(16)
        with self.lock:
            now = monotonic()
            self.recent_attempts("register", 10, now).append(now)
            password_hash = hash_password(password, salt)
            cursor = db.execute(
                """INSERT INTO users(username, username_key, salt, password_hash) VALUES (?, ?, ?, ?)
                   ON CONFLICT(username_key) DO NOTHING""",
                (username, username.casefold(), salt, password_hash),
            )
            if cursor.rowcount == 0:
                raise ApiError(409, "Этот логин уже занят.")
            db.commit()
            return self.new_session(Account(cursor.lastrowid, username), old_token, salt)

    def change_password(self, db, account, token, current_password, replacement):
        current = password_bytes(current_password)
        if current is None:
            raise ApiError(400, "Введите текущий пароль.")
        with self.lock:
            now = monotonic()
            session = self.sessions.get(token)
            credentials = db.execute("SELECT salt, password_hash FROM users WHERE id = ?", (account.user_id,)).fetchone()
            if not session or session[0] <= now or credentials is None or session[2] != credentials["salt"]:
                raise ApiError(401, "Войдите снова, чтобы сменить пароль.")
            attempts = self.recent_attempts("password", 10, now)
            current_hash = hash_password(current, credentials["salt"])
            if not secrets.compare_digest(current_hash, credentials["password_hash"]):
                attempts.append(now)
                raise ApiError(400, "Текущий пароль указан неверно.")
            salt = secrets.token_bytes(16)
            updated = db.execute(
                "UPDATE users SET salt = ?, password_hash = ? WHERE id = ? AND salt = ?",
                (salt, hash_password(replacement, salt), account.user_id, credentials["salt"]),
            )
            if updated.rowcount != 1:
                raise ApiError(401, "Войдите снова, чтобы сменить пароль.")
            db.commit()
            self.sessions = {
                key: value for key, value in self.sessions.items() if value[1].user_id != account.user_id
            }
            return self.new_session(account, token, salt)

    def new_session(self, account, old_token, salt):
        now = monotonic()
        self.sessions = {
            token: session for token, session in self.sessions.items()
            if session[0] > now and token != old_token
        }
        if len(self.sessions) >= 64:
            del self.sessions[next(iter(self.sessions))]
        token = secrets.token_urlsafe(32)
        self.sessions[token] = (now + SESSION_LIFETIME, account, salt)
        return token

    def logout(self, token):
        with self.lock:
            self.sessions.pop(token, None)


def admin_credentials(db):
    return db.execute("SELECT salt, password_hash FROM admin_credentials WHERE id = 1").fetchone()


def is_booking_owner_or_admin(account, owner_id):
    return account is not None and (account.is_admin or account.user_id == owner_id)


def is_group_participant(account, employee_ids, person):
    return (account is not None and account.employee_id in employee_ids
            and (len(employee_ids) > 1 or bool(person.strip())))


def require_booking_access(db, booking_id, account):
    row = db.execute("SELECT owner_id, start, end, all_day, person FROM bookings WHERE id = ?", (booking_id,)).fetchone()
    if row is None:
        raise ApiError(404, "Эта бронь уже удалена.")
    if is_booking_owner_or_admin(account, row["owner_id"]):
        return row
    employee_ids = [entry[0] for entry in db.execute(
        "SELECT employee_id FROM booking_employees WHERE booking_id = ?", (booking_id,),
    )]
    if is_group_participant(account, employee_ids, row["person"]):
        return row
    raise ApiError(403, "Изменить или отменить эту бронь может её владелец, указанный участник групповой брони или администратор.")


def public_booking(row, account, employee_ids, **fields):
    booking = dict(row, employee_ids=employee_ids, **fields)
    owner_id = booking.pop("owner_id")
    booking["can_edit"] = (
        is_booking_owner_or_admin(account, owner_id) or is_group_participant(account, employee_ids, booking["person"])
    )
    booking["can_cancel"] = booking["can_edit"]
    booking["has_owner"] = owner_id is not None
    booking["all_day"] = bool(booking["all_day"])
    return booking


def username_from(data):
    username = data.get("username")
    if not isinstance(username, str):
        return ""
    username = " ".join(username.split())
    return username if re.fullmatch(r"[\w. '’-]{3,100}", username) else ""


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


def in_period(db, params, account=None):
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
             (SELECT group_concat(employee_id) FROM booking_employees WHERE booking_id = b.id) AS employees,
             (SELECT group_concat(instrument_id || ':' || resonator_id)
              FROM booking_resonators WHERE booking_id = b.id) AS bindings
           FROM bookings AS b WHERE start < ? AND end > ? ORDER BY start, id""",
        (f"{last}T00:00", f"{first}T00:00"),
    )
    result = []
    for row in rows:
        employees = row["employees"]
        employee_ids = [int(item) for item in employees.split(",")] if employees else []
        entry = public_booking(row, account, employee_ids)
        entry["instrument_ids"] = [int(item) for item in entry.pop("instruments").split(",")]
        entry.pop("employees")
        bindings = entry.pop("bindings")
        entry["resonators"] = {}
        if bindings:
            for pair in bindings.split(","):
                instrument_id, resonator_id = pair.split(":")
                entry["resonators"][instrument_id] = int(resonator_id)
        result.append(entry)
    return result


def save_catalog_item(db, data, table, item_id=None):
    label, duplicate, missing = CATALOGS[table]
    name = clean_text(data, "name", label, 100)
    values = (name, name.casefold())
    try:
        if item_id is None:
            row = db.execute(
                f"INSERT INTO {table}(name, name_key) VALUES (?, ?) RETURNING id, name",
                values,
            ).fetchone()
        else:
            row = db.execute(
                f"UPDATE {table} SET name = ?, name_key = ? WHERE id = ? RETURNING id, name",
                (*values, item_id),
            ).fetchone()
    except sqlite3.IntegrityError:
        raise ApiError(409, duplicate) from None
    if row is None:
        raise ApiError(404, missing)
    return dict(row)


def rename_lab(db, data, lab_id):
    name = clean_text(data, "name", "Название подразделения", 100)
    try:
        row = db.execute(
            "UPDATE labs SET name = ?, name_key = ? WHERE id = ? RETURNING id, name, kind",
            (name, name.casefold(), lab_id),
        ).fetchone()
    except sqlite3.IntegrityError:
        raise ApiError(409, "Подразделение с таким названием уже есть.") from None
    if row is None:
        raise ApiError(404, "Подразделение не найдено.")
    return dict(row)


def valid_id(value):
    return type(value) is int and 1 <= value <= MAX_ID


def save_employee(db, data, employee_id=None):
    lab_id = data.get("lab_id")
    if not valid_id(lab_id) or not db.execute("SELECT 1 FROM labs WHERE id = ?", (lab_id,)).fetchone():
        raise ApiError(404, "Подразделение не найдено.")
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


def chosen_resonators(data, instrument_ids):
    resonators = data.get("resonators", {})
    keys = {str(item) for item in instrument_ids}
    if not isinstance(resonators, dict) or any(key not in keys or not valid_id(item) for key, item in resonators.items()):
        raise ApiError(400, "Укажите резонаторы только для выбранных приборов.")
    if len(set(resonators.values())) != len(resonators):
        raise ApiError(400, "Один резонатор можно выбрать только для одного прибора в брони.")
    return resonators


def check_resonators(db, resonators, start, end, booking_id):
    if not resonators:
        return
    ids = tuple(resonators.values())
    slots = placeholders(ids)
    count = db.execute(f"SELECT COUNT(*) FROM resonators WHERE id IN ({slots})", ids).fetchone()[0]
    if count != len(ids):
        raise ApiError(404, "Один из выбранных резонаторов не найден.")
    conflicts = db.execute(
        f"""SELECT DISTINCT r.name FROM booking_resonators AS x
            JOIN bookings AS b ON b.id = x.booking_id
            JOIN resonators AS r ON r.id = x.resonator_id
            WHERE x.resonator_id IN ({slots}) AND b.start < ? AND b.end > ? AND b.id != ?
            ORDER BY r.name""",
        (*ids, end, start, booking_id or 0),
    ).fetchall()
    if conflicts:
        names = ", ".join(f"«{row['name']}»" for row in conflicts)
        raise ApiError(409, f"На это время уже заняты резонаторы {names}.")


def check_instrument_conflicts(db, instrument_ids, start, end, booking_id):
    conflicts = db.execute(
        f"""SELECT DISTINCT i.name FROM booking_instruments AS x
            JOIN bookings AS b ON b.id = x.booking_id
            JOIN instruments AS i ON i.id = x.instrument_id
            WHERE x.instrument_id IN ({placeholders(instrument_ids)}) AND b.start < ? AND b.end > ? AND b.id != ?
            ORDER BY i.name""",
        (*instrument_ids, end, start, booking_id or 0),
    ).fetchall()
    if conflicts:
        names = ", ".join(f"«{row['name']}»" for row in conflicts)
        raise ApiError(409, f"На это время уже есть бронь для {names}.")


def move_booking(db, data, booking_id, account):
    db.execute("BEGIN IMMEDIATE")
    current = require_booking_access(db, booking_id, account)
    if (data.get("previous_start"), data.get("previous_end")) != (current["start"], current["end"]):
        raise ApiError(409, "Время брони уже изменилось. Перетащите её снова.")
    start = booking_time(data, "start", "Начало")
    if current["all_day"] and start[11:] != "00:00":
        raise ApiError(400, "Бронь на весь день должна начинаться в полночь.")
    duration = datetime.fromisoformat(current["end"]) - datetime.fromisoformat(current["start"])
    try:
        end = (datetime.fromisoformat(start) + duration).isoformat(timespec="minutes")
    except OverflowError:
        raise ApiError(400, "Выберите более раннюю дату, чтобы сохранить длительность брони.") from None
    instrument_ids = [
        row[0] for row in db.execute("SELECT instrument_id FROM booking_instruments WHERE booking_id = ?", (booking_id,))
    ]
    resonators = dict(db.execute("SELECT instrument_id, resonator_id FROM booking_resonators WHERE booking_id = ?", (booking_id,)))
    check_instrument_conflicts(db, instrument_ids, start, end, booking_id)
    check_resonators(db, resonators, start, end, booking_id)
    db.execute("UPDATE bookings SET start = ?, end = ? WHERE id = ?", (start, end, booking_id))


def save_booking(db, data, booking_id=None, *, account=None):
    owner_id = account.user_id if account else None
    if booking_id is None and "expected_username" in data:
        username = account.username if account else None
        if data["expected_username"] != username:
            raise ApiError(401, "Сеанс изменился. Проверьте, под какой учётной записью вы вошли, и сохраните бронь снова.")
    # Keep authorization, overlap checks, and the write in one transaction.
    db.execute("BEGIN IMMEDIATE")
    if booking_id is not None:
        require_booking_access(db, booking_id, account)
    instrument_ids = selected_ids(data.get("instrument_ids", [data.get("instrument_id")]), "Выберите приборы.")
    if not instrument_ids:
        raise ApiError(400, "Выберите хотя бы один прибор.")
    resonators = chosen_resonators(data, instrument_ids)
    employee_ids = selected_ids(data.get("employee_ids", []), "Проверьте список участников.")
    start = booking_time(data, "start", "Начало")
    end = booking_time(data, "end", "Окончание")
    all_day = data.get("all_day", False)
    if type(all_day) is not bool or (all_day and (start[11:] != "00:00" or end[11:] != "00:00")):
        raise ApiError(400, "Для брони на весь день укажите границы дней.")
    if end <= start:
        raise ApiError(400, "Окончание должно быть позже начала.")
    person = clean_text(data, "person", "Участники вручную", 100, required=False)
    if not person and not employee_ids:
        raise ApiError(400, "Выберите сотрудников или укажите участников вручную.")
    comment = clean_text(data, "comment", "Комментарий", 1000, required=False)

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
    check_instrument_conflicts(db, instrument_ids, start, end, booking_id)
    check_resonators(db, resonators, start, end, booking_id)

    values = instrument_ids[0], start, end, person, comment, all_day
    if booking_id is None:
        row = db.execute(
            """INSERT INTO bookings(instrument_id, start, end, person, comment, all_day, owner_id)
               VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            (*values, owner_id),
        ).fetchone()
    else:
        row = db.execute(
            """UPDATE bookings SET instrument_id = ?, start = ?, end = ?, person = ?, comment = ?, all_day = ?
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
    db.executemany(
        "INSERT INTO booking_resonators VALUES (?, ?, ?)",
        ((booking_id, int(instrument_id), resonator_id) for instrument_id, resonator_id in resonators.items()),
    )
    return public_booking(row, account, employee_ids, instrument_ids=instrument_ids, resonators=resonators)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.dispatch()

    do_POST = do_PUT = do_PATCH = do_DELETE = do_GET

    def dispatch(self):
        self.session_cookie = None
        try:
            network = self.server.lan_network
            if network is not None and IPv4Address(self.client_address[0]) not in network:
                raise ApiError(403, "Расписание доступно из локальной подсети.")
            host = self.headers.get("Host", "").lower()
            if host not in self.server.allowed_hosts:
                raise ApiError(403, "Откройте приложение по локальному адресу сервера.")
            if self.server.read_only and self.command != "GET":
                raise ApiError(403, "Этот экземпляр доступен только для просмотра.")
            origin = self.headers.get("Origin")
            if self.command != "GET" and origin is not None and origin != f"{self.server.scheme}://{host}":
                raise ApiError(403, "Запрос с другого сайта отклонён.")
            url = urlsplit(self.path)
            if self.command == "GET" and url.path in ASSETS:
                filename, content_type = ASSETS[url.path]
                self.respond(200, (ROOT / "static" / filename).read_bytes(), content_type)
                return

            if not url.path.startswith("/api/"):
                self.send_error(404)
                return

            with closing(sqlite3.connect(self.server.db_uri, uri=True, timeout=5)) as db, db:
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
        read_only = self.server.read_only
        token = None if read_only else self.session_token()
        sessions = self.server.sessions
        account = sessions.account(token, db) if token else None
        is_admin = account is not None and account.is_admin
        if path == "/api/session" and method == "GET":
            return 200, {
                "role": "admin" if is_admin else ("user" if account else "guest"),
                "username": account.username if account else None,
                "employee_id": account.employee_id if account else None,
                "admin_configured": not read_only and admin_credentials(db) is not None,
                "read_only": read_only,
                "supports_booking_move": not read_only,
            }
        if path == "/api/admin" and method == "GET":
            return 200, {"configured": not read_only and admin_credentials(db) is not None, "active": is_admin}
        if path == "/api/admin/login" and method == "POST":
            data = self.read_json()
            credentials = admin_credentials(db)
            if credentials is None:
                raise ApiError(403, "Пароль администратора ещё не задан на сервере.")
            token = sessions.login(data.get("password"), credentials, token, admin=True)
            self.set_session_cookie(token, SESSION_LIFETIME)
            return HTTPStatus.NO_CONTENT, None
        if path == "/api/login" and method == "POST":
            data = self.read_json()
            credentials = db.execute(
                "SELECT id, username, salt, password_hash, employee_id FROM users WHERE username_key = ?",
                (username_from(data).casefold(),),
            ).fetchone()
            token = sessions.login(data.get("password"), credentials, token)
            self.set_session_cookie(token, SESSION_LIFETIME)
            return HTTPStatus.NO_CONTENT, None
        if path == "/api/register" and method == "POST":
            data = self.read_json()
            username = username_from(data)
            if not username:
                raise ApiError(400, "Введите от 3 до 100 символов. Допустимы буквы, цифры, пробелы, точки, подчёркивания, дефисы и апострофы.")
            password = new_user_password(data.get("password"))
            token = sessions.register(db, username, password, token)
            self.set_session_cookie(token, SESSION_LIFETIME)
            return HTTPStatus.NO_CONTENT, None
        if path == "/api/password" and method == "POST":
            if account is None:
                raise ApiError(401, "Войдите, чтобы сменить пароль.")
            if is_admin:
                raise ApiError(403, "Этот способ смены пароля доступен обычным пользователям.")
            data = self.read_json()
            replacement = new_user_password(data.get("new_password"))
            token = sessions.change_password(db, account, token, data.get("current_password"), replacement)
            self.set_session_cookie(token, SESSION_LIFETIME)
            return HTTPStatus.NO_CONTENT, None
        if path in ("/api/logout", "/api/admin/logout") and method == "POST":
            self.read_json()
            if path == "/api/logout" or is_admin:
                sessions.logout(token)
                self.set_session_cookie("", 0)
            return HTTPStatus.NO_CONTENT, None
        match = re.fullmatch(r"/api/(instruments|resonators|labs|employees|bookings)/([1-9][0-9]{0,18})", path)
        booking_change = match and match[1] == "bookings" and method in ("PUT", "PATCH", "DELETE")
        if method != "GET" and (method, path) != ("POST", "/api/bookings"):
            if booking_change and account is None:
                raise ApiError(401, "Войдите, чтобы изменить или отменить бронь.")
            if not booking_change and not is_admin:
                if account is not None:
                    raise ApiError(403, "Это действие доступно администратору.")
                raise ApiError(401, "Войдите как администратор, чтобы выполнить это действие.")

        catalog = path.removeprefix("/api/")
        if catalog in CATALOGS:
            if method == "GET":
                rows = db.execute(f"SELECT id, name FROM {catalog} ORDER BY id")
                return 200, [dict(row) for row in rows]
            if method == "POST":
                return 201, save_catalog_item(db, self.read_json(), catalog)
        if path == "/api/directory" and method == "GET":
            return 200, {
                "labs": [dict(row) for row in db.execute("SELECT id, name, kind FROM labs ORDER BY id")],
                "employees": [dict(row) for row in db.execute("SELECT id, lab_id, name FROM employees ORDER BY name_key, id")],
            }
        if path == "/api/employees" and method == "POST":
            return 201, save_employee(db, self.read_json())
        if path == "/api/bookings":
            if method == "GET":
                return 200, in_period(db, parse_qs(url.query), account)
            if method == "POST":
                return 201, save_booking(db, self.read_json(), account=account)
        if match and (item_id := int(match[2])) <= MAX_ID:
            if method == "PATCH" and match[1] == "bookings":
                move_booking(db, self.read_json(), item_id, account)
                return HTTPStatus.NO_CONTENT, None
            if method == "PUT":
                data = self.read_json()
                if match[1] == "bookings":
                    return 200, save_booking(db, data, item_id, account=account)
                if match[1] in CATALOGS:
                    return 200, save_catalog_item(db, data, match[1], item_id)
                save = {"labs": rename_lab, "employees": save_employee}
                return 200, save[match[1]](db, data, item_id)
            if method == "DELETE" and match[1] == "bookings":
                if self.headers.get("Content-Type") != "application/json":
                    raise ApiError(415, "Ожидается запрос JSON.")
                db.execute("BEGIN IMMEDIATE")
                require_booking_access(db, item_id, account)
                db.execute("DELETE FROM bookings WHERE id = ?", (item_id,))
                return HTTPStatus.NO_CONTENT, None
        raise ApiError(404, "Запрошенный адрес не найден.")

    def session_token(self):
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", "")).get(self.server.session_cookie_name)
            return cookie.value if cookie else None
        except CookieError:
            return None

    def set_session_cookie(self, token, max_age):
        name = self.server.session_cookie_name
        secure = "; Secure" if self.server.scheme == "https" else ""
        self.session_cookie = f"{name}={token}; Max-Age={max_age}; Path=/api; HttpOnly; SameSite=Strict{secure}"

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
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        if self.session_cookie is not None:
            self.send_header("Set-Cookie", self.session_cookie)
        if status != HTTPStatus.NO_CONTENT:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def initialize_database(db_path):
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as db, db:
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript("BEGIN IMMEDIATE;\n" + SCHEMA)
        columns = {row[1] for row in db.execute("PRAGMA table_info(bookings)")}
        if "all_day" not in columns:
            db.execute("ALTER TABLE bookings ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1))")
        if "owner_id" not in columns:
            db.execute("ALTER TABLE bookings ADD COLUMN owner_id INTEGER REFERENCES users(id)")
        if not any(row[1] == "employee_id" for row in db.execute("PRAGMA table_info(users)")):
            db.execute("ALTER TABLE users ADD COLUMN employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL")
        if not any(row[1] == "kind" for row in db.execute("PRAGMA table_info(labs)")):
            db.execute(
                "ALTER TABLE labs ADD COLUMN kind TEXT NOT NULL DEFAULT 'lab' CHECK (kind IN ('lab', 'department'))"
            )
        db.execute("INSERT OR IGNORE INTO booking_instruments SELECT id, instrument_id FROM bookings")
        labs = [(number, f"Лаборатория {number}") for number in range(1, 5)]
        db.executemany(
            "INSERT OR IGNORE INTO labs(id, name, name_key) VALUES (?, ?, ?)",
            ((lab_id, name, name.casefold()) for lab_id, name in labs),
        )
        if not db.execute("SELECT 1 FROM labs WHERE kind = 'department'").fetchone():
            name = "Отдел ЭПР-спектроскопии"
            db.execute(
                """INSERT INTO labs(name, name_key, kind) VALUES (?, ?, 'department')
                   ON CONFLICT(name_key) DO UPDATE SET kind = excluded.kind""",
                (name, name.casefold()),
            )


def lan_interface(value):
    try:
        interface = IPv4Interface(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Укажите локальный IPv4 с префиксом, например 192.168.1.10/24.") from None
    if "/" not in value or not any(interface.network.subnet_of(network) for network in LAN_NETWORKS):
        raise argparse.ArgumentTypeError("Укажите частный IPv4 и префикс локальной подсети, например 192.168.1.10/24.")
    return interface


class HttpsServer(ThreadingHTTPServer):
    def __init__(self, address, tls_context):
        self.tls_context = tls_context
        super().__init__(address, Handler)

    def process_request_thread(self, request, client_address):
        # Run the handshake in the request thread so it cannot stall other clients.
        request.settimeout(10)
        try:
            connection = self.tls_context.wrap_socket(request, server_side=True)
        except OSError:
            self.close_request(request)
            return
        super().process_request_thread(connection, client_address)


def create_server(port, db_path, lan_view=None, *, lan_edit=None, tls_context=None):
    if (lan_edit is None) != (tls_context is None) or (lan_view is not None and lan_edit is not None):
        raise ValueError("Для редактирования по локальной сети нужен HTTPS.")
    db_path = Path(db_path).resolve()
    lan = lan_view or lan_edit
    if lan is not None and not db_path.is_file():
        raise FileNotFoundError(f"База данных не найдена: {db_path}")
    if lan_view is None:
        initialize_database(db_path)
    host = str(lan.ip) if lan is not None else "127.0.0.1"
    address = host, port
    server = HttpsServer(address, tls_context) if tls_context is not None else ThreadingHTTPServer(address, Handler)
    server.scheme = "https" if tls_context is not None else "http"
    server.lan_network = lan.network if lan is not None else None
    server.read_only = lan_view is not None
    mode = "ro" if server.read_only else "rw"
    server.db_uri = f"{db_path.as_uri()}?mode={mode}"
    server.sessions = Sessions()
    server.session_cookie_name = f"booking_session_{server.server_port}"
    default_port = 443 if server.scheme == "https" else 80
    suffix = "" if server.server_port == default_port else f":{server.server_port}"
    server.allowed_hosts = {f"{host}{suffix}"}
    if lan is None:
        server.allowed_hosts.add(f"localhost{suffix}")
    return server


def set_admin_password(db_path, password):
    salt = secrets.token_bytes(16)
    password_hash = hash_password(password.encode("utf-8"), salt)
    initialize_database(db_path)
    with closing(sqlite3.connect(db_path)) as db, db:
        db.execute(
            """INSERT INTO admin_credentials VALUES (1, ?, ?)
               ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, password_hash = excluded.password_hash""",
            (salt, password_hash),
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "schedule.sqlite3")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--set-admin-password", action="store_true", help="set or replace the local administrator password")
    mode.add_argument("--lan-view", type=lan_interface, metavar="IP/PREFIX", help="serve an existing database read-only on a private IPv4 subnet")
    mode.add_argument("--lan-edit", type=lan_interface, metavar="IP/PREFIX", help="serve an existing database over HTTPS on a private IPv4 subnet")
    parser.add_argument("--tls-cert", type=Path, help="server certificate and optional chain in PEM format for --lan-edit")
    parser.add_argument("--tls-key", type=Path, help="private key in PEM format for --lan-edit")
    args = parser.parse_args()
    tls_context = None
    if args.lan_edit is not None:
        if args.tls_cert is None or args.tls_key is None:
            parser.error("Для --lan-edit нужны --tls-cert и --tls-key.")
        try:
            tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls_context.load_cert_chain(args.tls_cert, args.tls_key)
        except OSError as error:
            parser.error(f"Не удалось загрузить сертификат или ключ HTTPS: {error}")
    elif args.tls_cert is not None or args.tls_key is not None:
        parser.error("Параметры --tls-cert и --tls-key используются с --lan-edit.")
    if args.set_admin_password:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", GetPassWarning)
                password = getpass("Новый пароль администратора: ")
                if not 12 <= len(password) <= 1024:
                    parser.error("Пароль должен содержать от 12 до 1024 символов.")
                if password != getpass("Повторите пароль: "):
                    parser.error("Пароли не совпадают.")
        except (EOFError, GetPassWarning):
            parser.error("Введите пароль в интерактивном терминале.")
        set_admin_password(args.db, password)
        print("Пароль администратора задан.")
        return
    with create_server(args.port, args.db, args.lan_view, lan_edit=args.lan_edit, tls_context=tls_context) as server:
        host, port = server.server_address
        print(f"Calendar URL: {server.scheme}://{host}:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
