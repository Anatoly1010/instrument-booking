"use strict";

const $ = (selector) => document.querySelector(selector);
const calendar = $("#calendar");
const datePicker = $("#calendar-date");
const instrumentDialog = $("#instrument-dialog");
const instrumentForm = $("#instrument-form");
const instrumentName = instrumentForm.elements.namedItem("name");
const renameInstrument = $("#rename-instrument");
const bookingDialog = $("#booking-dialog");
const bookingForm = $("#booking-form");
const deleteButton = $("#delete-booking");
const weekdayFormat = new Intl.DateTimeFormat("ru", { weekday: "short" });
const dayFormat = new Intl.DateTimeFormat("ru", { dateStyle: "full" });
const rangeFormat = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("ru", { month: "long", year: "numeric" });
const hues = [138, 173, 270, 24, 330, 47, 205];

const state = {
  date: new Date(),
  view: "week",
  instruments: [],
  activeId: null,
  allInstruments: false,
  bookings: [],
  editingInstrumentId: null,
  editingId: null,
  requestId: 0,
};

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateKey(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromKey(key) {
  return new Date(`${key}T12:00`);
}

function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function firstOfMonth(date, offset = 0) {
  const result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() + offset);
  return result;
}

function mondayOffset(date) {
  return (date.getDay() + 6) % 7;
}

function visibleDays() {
  if (state.view === "day") return [state.date];
  if (state.view === "month") {
    const first = firstOfMonth(state.date);
    const count = addDays(firstOfMonth(state.date, 1), -1).getDate();
    return Array.from({ length: count }, (_, index) => addDays(first, index));
  }
  const monday = addDays(state.date, -mondayOffset(state.date));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function setStatus(message = "") {
  const status = $("#status");
  status.textContent = message;
  status.hidden = !message;
}

async function api(path, method = "GET", payload) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw new Error("Сервер недоступен. Проверьте, что приложение запущено.");
  }
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос.");
  return data;
}

function instrumentColor(id) {
  return hues[(id - 1) % hues.length];
}

function renderInstruments() {
  const items = state.instruments.map((instrument) => {
    const button = element("button", "instrument");
    button.type = "button";
    button.dataset.id = instrument.id;
    const swatch = element("span", "swatch");
    swatch.setAttribute("aria-hidden", "true");
    swatch.style.setProperty("--hue", instrumentColor(instrument.id));
    button.append(swatch, element("span", "", instrument.name));
    return button;
  });
  if (items.length) {
    const all = element("button", "instrument all-instruments", "Все приборы");
    all.type = "button";
    all.dataset.id = "all";
    items.unshift(all);
  }
  $("#instruments").replaceChildren(...items);
  markInstrumentSelection();
}

function markInstrumentSelection() {
  const active = state.allInstruments ? "all" : String(state.activeId);
  for (const button of $("#instruments").children) {
    button.setAttribute("aria-pressed", String(button.dataset.id === active));
  }
}

function setView(view) {
  state.view = view;
  if (view !== "month") state.allInstruments = false;
  for (const button of document.querySelectorAll(".view-picker button")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  markInstrumentSelection();
  refreshCalendar(true);
}

function minutes(timestamp) {
  return Number(timestamp.slice(11, 13)) * 60 + Number(timestamp.slice(14, 16));
}

function clock(timestamp) {
  return timestamp.slice(11, 16);
}

function daySegment(booking, day, nextDay) {
  const start = booking.start.slice(0, 10) < day ? 0 : minutes(booking.start);
  const end = booking.end.slice(0, 10) >= nextDay ? 1440 : minutes(booking.end);
  const label = `${start === 0 ? "00:00" : clock(booking.start)}–${end === 1440 ? "24:00" : clock(booking.end)}`;
  return { start, end, label };
}

function bookingsOnDay(bookings, day, nextDay) {
  return bookings.filter((booking) => booking.start < `${nextDay}T00:00` && booking.end > `${day}T00:00`);
}

function renderEvent(booking, day, nextDay) {
  const { start, end, label: timeLabel } = daySegment(booking, day, nextDay);
  const button = element("button", end - start < 28 ? "event compact" : "event");
  button.type = "button";
  button.dataset.booking = booking.id;
  button.style.top = `${start / 14.4}%`;
  button.style.height = `${(end - start) / 14.4}%`;
  button.title = `${timeLabel} · ${booking.person}${booking.comment ? `\n${booking.comment}` : ""}`;
  button.setAttribute("aria-label", `${timeLabel}, ${booking.person}. Открыть бронь`);
  button.append(element("strong", "", booking.person), element("span", "", timeLabel));
  return button;
}

function renderTimeGrid(days, bookings) {
  calendar.style.setProperty("--days", days.length);
  calendar.style.setProperty("--hue", instrumentColor(state.activeId));
  const headings = element("div", "day-headings");
  const grid = element("div", "time-grid");
  const hours = element("div", "hours");
  const today = dateKey(new Date());

  headings.append(element("div", "corner", "Время"));
  for (let hour = 0; hour < 24; hour += 1) {
    hours.append(element("span", "hour", `${pad(hour)}:00`));
  }
  grid.append(hours);

  for (const date of days) {
    const day = dateKey(date);
    const nextDay = dateKey(addDays(date, 1));
    const heading = element("div", day === today ? "date-heading today" : "date-heading", weekdayFormat.format(date));
    const time = element("time", "", `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`);
    time.dateTime = day;
    heading.append(time);
    headings.append(heading);

    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const column = element("div", weekend ? "calendar-day weekend" : "calendar-day");
    const fullDate = dayFormat.format(date);
    for (let hour = 0; hour < 24; hour += 1) {
      const slot = element("button", "slot");
      const timeLabel = `${pad(hour)}:00`;
      slot.type = "button";
      slot.dataset.start = `${day}T${timeLabel}`;
      slot.setAttribute("aria-label", `${fullDate}, ${timeLabel}. Создать бронь`);
      column.append(slot);
    }
    for (const booking of bookingsOnDay(bookings, day, nextDay)) {
      column.append(renderEvent(booking, day, nextDay));
    }
    grid.append(column);
  }

  calendar.replaceChildren(headings, grid);
}

function renderMonth(days, bookings) {
  const headings = element("div", "month-headings");
  const grid = element("div", "month-grid");
  const today = dateKey(new Date());
  const names = new Map(state.instruments.map(({ id, name }) => [id, name]));
  const offset = mondayOffset(days[0]);
  const monday = addDays(days[0], -offset);
  for (let index = 0; index < 7; index += 1) {
    headings.append(element("div", "date-heading", weekdayFormat.format(addDays(monday, index))));
  }

  const cellCount = Math.ceil((offset + days.length) / 7) * 7;
  for (let index = 0; index < cellCount; index += 1) {
    const date = days[index - offset];
    if (!date) {
      const blank = element("div", "month-cell outside-month");
      blank.setAttribute("aria-hidden", "true");
      grid.append(blank);
      continue;
    }

    const day = dateKey(date);
    const nextDay = dateKey(addDays(date, 1));
    const cell = element("div", day === today ? "month-cell today" : "month-cell");
    const dayButton = element("button", "month-date", String(date.getDate()));
    dayButton.type = "button";
    dayButton.dataset.start = `${day}T09:00`;
    dayButton.setAttribute("aria-label", `${dayFormat.format(date)}. Создать бронь`);
    cell.append(dayButton);
    for (const booking of bookingsOnDay(bookings, day, nextDay)) {
      const name = names.get(booking.instrument_id);
      const label = daySegment(booking, day, nextDay).label;
      const event = element("button", "month-event");
      event.type = "button";
      event.dataset.booking = booking.id;
      event.style.setProperty("--hue", instrumentColor(booking.instrument_id));
      event.title = `${label} · ${name} · ${booking.person}`;
      event.setAttribute("aria-label", `${label}, ${name}, ${booking.person}. Открыть бронь`);
      event.append(element("span", "month-event-time", label), element("strong", "", state.allInstruments ? name : booking.person));
      cell.append(event);
    }
    grid.append(cell);
  }
  calendar.replaceChildren(headings, grid);
}

function renderCalendar(days, resetScroll) {
  const previousScroll = calendar.scrollTop;
  const previousLeft = calendar.scrollLeft;
  const bookings = state.allInstruments ? state.bookings
    : state.bookings.filter((booking) => booking.instrument_id === state.activeId);
  calendar.dataset.view = state.view;
  if (state.view === "month") renderMonth(days, bookings);
  else renderTimeGrid(days, bookings);
  calendar.scrollTop = resetScroll ? (calendar.querySelector(".hour")?.offsetHeight ?? 0) * 8 : previousScroll;
  calendar.scrollLeft = resetScroll ? 0 : previousLeft;
}

async function refreshCalendar(resetScroll = false) {
  const requestId = ++state.requestId;
  const instrument = state.instruments.find((item) => item.id === state.activeId);
  const days = visibleDays();
  const first = days[0];
  const last = days.at(-1);
  $("#calendar-title").textContent = state.allInstruments ? "Все приборы" : instrument?.name || "Календарь";
  renameInstrument.hidden = !instrument || state.allInstruments;
  let period = "";
  if (instrument) {
    if (state.view === "month") period = monthFormat.format(first);
    else if (state.view === "day") period = dayFormat.format(first);
    else period = rangeFormat.formatRange(first, last);
  }
  $("#period").textContent = period;
  datePicker.value = dateKey(state.date);
  $("#new-booking").disabled = !instrument;
  $("#empty").hidden = Boolean(instrument);
  calendar.hidden = !instrument;
  if (!instrument) return;

  setStatus();
  state.bookings = [];
  renderCalendar(days, resetScroll);
  calendar.setAttribute("aria-busy", "true");
  try {
    const data = await api(`bookings?from=${dateKey(first)}&to=${dateKey(addDays(last, 1))}`);
    if (requestId !== state.requestId) return;
    state.bookings = data;
    renderCalendar(days, false);
  } catch (error) {
    if (requestId === state.requestId) setStatus(error.message);
  } finally {
    if (requestId === state.requestId) calendar.removeAttribute("aria-busy");
  }
}

function formError(form, message = "") {
  const target = form.querySelector(".form-error");
  target.textContent = message;
  target.hidden = !message;
}

async function submit(form, action) {
  formError(form);
  const buttons = Array.from(form.querySelectorAll("button"));
  buttons.forEach((button) => { button.disabled = true; });
  form.dataset.pending = "true";
  try {
    await action();
  } catch (error) {
    formError(form, error.message);
  } finally {
    delete form.dataset.pending;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function openInstrumentForm(instrument = null) {
  state.editingInstrumentId = instrument?.id ?? null;
  instrumentName.value = instrument?.name ?? "";
  $("#instrument-dialog-title").textContent = instrument ? "Переименовать прибор" : "Добавить прибор";
  $("#save-instrument").textContent = instrument ? "Сохранить" : "Добавить";
  formError(instrumentForm);
  instrumentDialog.showModal();
  if (instrument) instrumentName.select();
}

function openBookingForm(booking, slotStart) {
  if (state.activeId === null) return;
  const start = booking?.start || slotStart || `${dateKey(state.date)}T09:00`;
  const hour = Number(start.slice(11, 13));
  const nextHour = hour === 23 ? `${dateKey(addDays(fromKey(start.slice(0, 10)), 1))}T00:00`
    : `${start.slice(0, 10)}T${pad(hour + 1)}:00`;
  const fields = bookingForm.elements;
  state.editingId = booking?.id ?? null;
  $("#booking-dialog-title").textContent = booking ? "Изменить бронь" : "Новая бронь";
  deleteButton.hidden = !booking;
  fields.instrument_id.replaceChildren(...state.instruments.map((item) => new Option(item.name, item.id)));
  fields.instrument_id.value = booking?.instrument_id ?? state.activeId;
  fields.start.value = start;
  fields.end.value = booking?.end || nextHour;
  fields.person.value = booking?.person || "";
  fields.comment.value = booking?.comment || "";
  formError(bookingForm);
  bookingDialog.showModal();
  fields.person.focus();
}

$("#instruments").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button || button.getAttribute("aria-pressed") === "true") return;
  state.allInstruments = button.dataset.id === "all";
  if (state.allInstruments) {
    setView("month");
    return;
  }
  state.activeId = Number(button.dataset.id);
  markInstrumentSelection();
  refreshCalendar();
});

$("#new-instrument").addEventListener("click", () => openInstrumentForm());
$("#empty-add").addEventListener("click", () => openInstrumentForm());
renameInstrument.addEventListener("click", () => {
  const instrument = state.instruments.find(({ id }) => id === state.activeId);
  if (instrument) openInstrumentForm(instrument);
});
$("#new-booking").addEventListener("click", () => openBookingForm());
calendar.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.start) openBookingForm(null, button.dataset.start);
  if (button.dataset.booking) openBookingForm(state.bookings.find((booking) => booking.id === Number(button.dataset.booking)));
});

for (const button of document.querySelectorAll(".view-picker button")) {
  button.addEventListener("click", () => setView(button.dataset.view));
}

for (const [selector, direction] of [["#previous", -1], ["#next", 1]]) {
  $(selector).addEventListener("click", () => {
    const monthView = state.view === "month";
    state.date = monthView ? firstOfMonth(state.date, direction)
      : addDays(state.date, direction * (state.view === "week" ? 7 : 1));
    refreshCalendar(monthView);
  });
}

$("#today").addEventListener("click", () => {
  state.date = new Date();
  refreshCalendar(true);
});

datePicker.addEventListener("change", () => {
  state.date = datePicker.value ? fromKey(datePicker.value) : new Date();
  refreshCalendar();
});

for (const dialog of document.querySelectorAll("dialog")) {
  for (const button of dialog.querySelectorAll("[data-close]")) {
    button.addEventListener("click", () => dialog.close());
  }
  dialog.addEventListener("cancel", (event) => {
    if (dialog.querySelector("form").dataset.pending) event.preventDefault();
  });
}

instrumentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(instrumentForm, async () => {
    const editingId = state.editingInstrumentId;
    const payload = { name: instrumentName.value };
    if (editingId === null) {
      const item = await api("instruments", "POST", payload);
      state.instruments.push(item);
      state.activeId = item.id;
      state.allInstruments = false;
    } else {
      const item = await api(`instruments/${editingId}`, "PUT", payload);
      state.instruments = state.instruments.map((instrument) => instrument.id === item.id ? item : instrument);
    }
    renderInstruments();
    instrumentDialog.close();
    refreshCalendar(editingId === null);
  });
});

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(bookingForm, async () => {
    const fields = new FormData(bookingForm);
    const payload = Object.fromEntries(fields);
    payload.instrument_id = Number(payload.instrument_id);
    const editing = state.editingId !== null;
    const booking = await api(editing ? `bookings/${state.editingId}` : "bookings", editing ? "PUT" : "POST", payload);
    state.activeId = booking.instrument_id;
    state.date = fromKey(booking.start.slice(0, 10));
    renderInstruments();
    bookingDialog.close();
    refreshCalendar();
  });
});

deleteButton.addEventListener("click", () => {
  if (!window.confirm("Удалить эту бронь?")) return;
  submit(bookingForm, async () => {
    await api(`bookings/${state.editingId}`, "DELETE");
    bookingDialog.close();
    refreshCalendar();
  });
});

async function start() {
  $("#new-instrument").disabled = true;
  try {
    state.instruments = await api("instruments");
    state.activeId = state.instruments[0]?.id ?? null;
    renderInstruments();
  } catch (error) {
    setStatus(error.message);
  } finally {
    $("#new-instrument").disabled = false;
    refreshCalendar(true);
  }
}

start();
