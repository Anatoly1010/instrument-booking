# Instrument Booking

This is a local lab calendar for booking instruments and optional resonators. The server uses Python's standard library and SQLite. The browser interface uses plain HTML, CSS, and JavaScript.

## Run locally

Use Python 3.10 or later. From the repository root, run:

```powershell
py -3 server.py
```

Open `http://127.0.0.1:8765`. The default database is `data/schedule.sqlite3`. Use `--port` and `--db` to run a separate test instance with a disposable database. The `data/` directory is ignored by Git.

## Project layout

- `server.py` defines the HTTP API, SQLite schema and startup migrations, and booking validation.
- `static/index.html` contains the calendar and booking dialogs. `static/app.js` handles views, filters, and user interactions. `static/styles.css` contains the responsive layout and colors.
- `README.md` contains setup and usage instructions in Russian. Keep new interface text in Russian.

## Booking behavior

- Keep existing SQLite data readable when changing the schema. Booking timestamps represent local lab time at minute precision.
- Check all selected instruments and resonators within the same transaction as the booking write. Adjacent intervals can share an endpoint. A conflict on any resource rejects the whole booking.
- A shared booking has one ID and keeps the same time and participants across all selected instruments. The month and four-week views use colored strips to show the resources involved.

## Verify changes

Run `py -3 -m py_compile server.py` after editing Python. Exercise the affected feature in a browser with a disposable database. For booking changes, check creation, editing, cancellation, and conflicts across resources. For schema changes, also start the server against a copy of an existing database and verify the bookings after restart.
