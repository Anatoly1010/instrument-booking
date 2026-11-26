# Instrument Booking

This is a local lab calendar for booking instruments and optional resonators. The server uses Python's standard library and SQLite. The browser interface uses plain HTML, CSS, and JavaScript.

## Run locally

Use Python 3.10 or later. From the repository root, run:

```powershell
py -3 server.py
```

Open `http://127.0.0.1:8765`. The default database is `data/schedule.sqlite3`. Use `--port` and `--db` to run a separate test instance with a disposable database. The `data/` directory is ignored by Git.

For the current Teamup review, use the separate preview database and open `http://127.0.0.1:8767`:

```powershell
py -3 server.py --port 8767 --db data/teamup-import-20261126-081307/preview.sqlite3
```

The default server binds to `127.0.0.1`. Use `--lan-view IP/PREFIX` on a separate port to share an existing database for viewing. It binds to the specified private IPv4 address, restricts requests to that subnet, and opens SQLite in read-only mode.

Use `--lan-edit IP/PREFIX` with `--tls-cert` and `--tls-key` to share an existing database for editing over HTTPS. This mode restricts access to the selected subnet, uses the usual account permissions, and sets secure session cookies.

The current pilot shares the Teamup preview at `https://192.168.1.129:8769/`:

```powershell
py -3 server.py --lan-edit 192.168.1.129/24 --port 8769 `
  --db data/teamup-import-20261126-081307/preview.sqlite3 `
  --tls-cert data/lan-https/booking-server.pem --tls-key data/lan-https/booking-server.key
```

The server certificate covers the LAN IP address. For this pilot, have clients trust `data/lan-https/instrument-booking-lan-ca.cer`. Share that public certificate and keep the private key on the server under the ignored `data/` directory.

## Project layout

- `server.py` defines the HTTP API, SQLite schema and startup migrations, and booking validation.
- `static/index.html` contains the calendar and booking dialogs. `static/app.js` handles views, filters, and user interactions. `static/styles.css` contains the responsive layout and colors.
- `README.md` contains setup and usage instructions in Russian. Keep new interface text in Russian.

## Booking behavior

- Keep existing SQLite data readable when changing the schema. Booking timestamps represent local lab time at minute precision.
- Check all selected instruments and resonators within the same transaction as the booking write. Adjacent intervals can share an endpoint. A conflict on any resource rejects the whole booking.
- A shared booking has one ID and keeps the same time and participants across all selected instruments. The month and four-week views use colored strips to show the resources involved.
- Authors and administrators can drag individual bookings. Month and four-week views shift the date. Day and week views move timed bookings in 15-minute steps and shift all-day bookings by date. The move preserves duration, participants, and resources.
- `PATCH /api/bookings/{id}` checks the previous start and end and rechecks resource conflicts before updating the booking time.
- The calendar opens in the four-week view. Utilization counts each shared booking for every selected instrument and clips booked time to the displayed period.

## Accounts and access

- Guests can view the calendar and create bookings. A signed-in user can edit, move, or cancel bookings created under that account. Administrators can manage the catalogs and all bookings.
- Issued staff accounts use surnames as logins. The sign-in form explains this, and the header prompts guests to sign in before booking. The prompt disappears after sign-in and stays hidden in LAN view mode.
- A staff account linked to a directory entry preselects that employee in a new booking. Other users get a preselection when their full-name login uniquely matches a directory entry. Editing an existing booking uses its saved participant list.
- Signed-in users can change their password from the header by providing the current password. The server saves a new salted hash, rotates the current session, and ends other sessions for the same account.

## Teamup preview

- The current preview has 297 imported bookings and 26 directory-linked staff accounts. The imported bookings have no account owner, so only administrators can edit them. The import report and mappings are in `data/teamup-import-20261126-081307/`.
- Source category mappings determine the instruments on each booking. Preserve the single booking ID for events with multiple instruments and keep unresolved participant names as text.
- When regenerating a preview after review has started, preserve its linked accounts, changed passwords, and any review edits, or build a separate copy for comparison.

## Verify changes

Run `py -3 -m py_compile server.py` after editing Python. Exercise the affected feature in a browser with a disposable database.

For booking changes, check creation, editing, cancellation, and conflicts across resources. When changing drag behavior, try all four calendar views and verify that a conflicting move leaves the original booking in place.

For account changes, verify that booking ownership survives a password change. When changing the guest prompt, check it before sign-in, after sign-in and sign-out, and in LAN view mode. For schema changes, start the server against a copy of an existing database and verify the bookings after restart.

For changes to LAN editing, verify the certificate and IPv4 address, sign in over HTTPS, and check booking ownership and conflict handling. Check that the HTTP viewing instance still rejects writes.
