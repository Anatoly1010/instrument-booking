"use strict";

const $ = (selector) => document.querySelector(selector);
const calendar = $("#calendar");
const datePicker = $("#calendar-date");
const instrumentDialog = $("#instrument-dialog");
const instrumentForm = $("#instrument-form");
const instrumentName = instrumentForm.elements.namedItem("name");
const renameInstrument = $("#rename-instrument");
const dayBookingsDialog = $("#day-bookings-dialog");
const directoryDialog = $("#directory-dialog");
const directoryLab = $("#directory-lab");
const labForm = $("#lab-form");
const employeeForm = $("#employee-form");
const bookingLab = $("#booking-lab");
const bookingDialog = $("#booking-dialog");
const bookingForm = $("#booking-form");
const deleteButton = $("#delete-booking");
const weekdayFormat = new Intl.DateTimeFormat("ru", { weekday: "short" });
const dayFormat = new Intl.DateTimeFormat("ru", { dateStyle: "full" });
const rangeFormat = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("ru", { month: "long", year: "numeric" });
const hues = [145, 183, 268, 23, 332, 45, 216];

const state = {
  date: new Date(),
  view: "week",
  instruments: [],
  labs: [],
  employees: [],
  activeId: null,
  allInstruments: false,
  bookings: [],
  editingInstrumentId: null,
  editingEmployeeId: null,
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

function isOverview(view) {
  return view === "month" || view === "rolling";
}

function visibleDays() {
  if (state.view === "day") return [state.date];
  if (state.view === "month") {
    const first = firstOfMonth(state.date);
    const count = addDays(firstOfMonth(state.date, 1), -1).getDate();
    return Array.from({ length: count }, (_, index) => addDays(first, index));
  }
  const monday = addDays(state.date, -mondayOffset(state.date));
  return Array.from({ length: state.view === "rolling" ? 28 : 7 }, (_, index) => addDays(monday, index));
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
    button.title = instrument.name;
    const swatch = element("span", "swatch");
    swatch.setAttribute("aria-hidden", "true");
    swatch.style.setProperty("--hue", instrumentColor(instrument.id));
    button.append(swatch, element("span", "instrument-name", instrument.name));
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
  if (!isOverview(view)) state.allInstruments = false;
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

function dateAndClock(timestamp) {
  return `${timestamp.slice(8, 10)}.${timestamp.slice(5, 7)} ${clock(timestamp)}`;
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

function bookingPeople(booking) {
  const names = booking.employee_ids.map((id) => state.employees.find((employee) => employee.id === id)?.name);
  return [...names, booking.person].filter(Boolean).join(", ") || "Участники";
}

function renderEvent(booking, day, nextDay) {
  const { start, end, label: timeLabel } = daySegment(booking, day, nextDay);
  const button = element("button", end - start < 28 ? "event compact" : "event");
  button.type = "button";
  button.dataset.booking = booking.id;
  button.style.top = `${start / 14.4}%`;
  button.style.height = `${(end - start) / 14.4}%`;
  const people = bookingPeople(booking);
  button.title = `${timeLabel} · ${people}${booking.comment ? `\n${booking.comment}` : ""}`;
  button.setAttribute("aria-label", `${timeLabel}, ${people}. Открыть бронь`);
  button.append(element("strong", "", people), element("span", "", timeLabel));
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

function renderMonthEvent(booking, day, nextDay, name) {
  const label = daySegment(booking, day, nextDay).label;
  const event = element("button", "month-event");
  event.type = "button";
  event.dataset.booking = booking.id;
  event.style.setProperty("--hue", instrumentColor(state.activeId));
  const people = bookingPeople(booking);
  event.title = `${label} · ${name} · ${people}`;
  event.setAttribute("aria-label", `${label}, ${name}, ${people}. Открыть бронь`);
  event.append(element("span", "month-event-time", label), element("strong", "", people));
  return event;
}

function openDayBookings(name, day, nextDay, bookings) {
  $("#day-bookings-title").textContent = name;
  $("#day-bookings-date").textContent = dayFormat.format(fromKey(day));
  const entries = bookings.map((booking) => {
    const label = daySegment(booking, day, nextDay).label;
    const item = element("button", "button day-booking", `${label} · ${bookingPeople(booking)}`);
    item.type = "button";
    item.addEventListener("click", () => {
      dayBookingsDialog.close();
      openBookingForm(booking);
    });
    return item;
  });
  $("#day-bookings-list").replaceChildren(...entries);
  dayBookingsDialog.showModal();
}

function renderMonthOverviewCell(bookings, day, nextDay, joinsPrevious, joinsNext) {
  const list = element("div", "overview-bookings");
  const groups = new Map();
  for (const booking of bookings) {
    for (const id of booking.instrument_ids) {
      const group = groups.get(id) ?? [];
      group.push(booking);
      groups.set(id, group);
    }
  }
  for (const [lane, { id, name }] of state.instruments.entries()) {
    const group = groups.get(id);
    if (!group) continue;
    const descriptions = group.map((booking) => {
      const label = daySegment(booking, day, nextDay).label;
      const interval = booking.start.slice(0, 10) === booking.end.slice(0, 10) ? label
        : `${dateAndClock(booking.start)}–${dateAndClock(booking.end)}`;
      return { people: bookingPeople(booking), label, interval };
    });
    const item = element("button", "overview-booking");
    item.type = "button";
    item.style.gridRow = String(lane + 1);
    item.style.setProperty("--hue", instrumentColor(id));
    item.classList.toggle("continues-previous", joinsPrevious && group.some((booking) => booking.start < `${day}T00:00`));
    item.classList.toggle("continues-next", joinsNext && group.some((booking) => booking.end > `${nextDay}T00:00`));
    item.title = `${name} (${descriptions.map(({ people, interval }) => `${people} · ${interval}`).join("; ")})`;
    const action = group.length === 1 ? "Открыть бронь" : "Открыть список броней";
    item.setAttribute("aria-label", `${item.title}. ${action}`);
    const { people, label } = descriptions[0];
    item.append(element("span", "overview-name", `${name} (${label.replaceAll(":00", "")} · ${people})`));
    if (group.length === 1) {
      item.dataset.booking = group[0].id;
    } else {
      item.append(element("span", "overview-count", String(group.length)));
      item.addEventListener("click", () => openDayBookings(name, day, nextDay, group));
    }
    list.append(item);
  }
  return list;
}

function renderMonth(days, bookings) {
  const headings = element("div", "month-headings");
  const grid = element("div", state.allInstruments ? "month-grid month-overview" : "month-grid");
  const today = dateKey(new Date());
  const instrument = state.instruments.find(({ id }) => id === state.activeId);
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
    const withMonth = state.view === "rolling" && (index === 0 || date.getDate() === 1);
    const dateLabel = withMonth ? `${pad(date.getDate())}.${pad(date.getMonth() + 1)}` : String(date.getDate());
    const dayButton = element("button", "month-date", dateLabel);
    dayButton.type = "button";
    dayButton.dataset.start = `${day}T09:00`;
    dayButton.setAttribute("aria-label", `${dayFormat.format(date)}. Создать бронь`);
    cell.append(dayButton);
    const entries = bookingsOnDay(bookings, day, nextDay);
    if (state.allInstruments) {
      const joinsPrevious = index > offset && index % 7 !== 0;
      const joinsNext = index < offset + days.length - 1 && index % 7 !== 6;
      cell.append(renderMonthOverviewCell(entries, day, nextDay, joinsPrevious, joinsNext));
    } else {
      for (const booking of entries) {
        cell.append(renderMonthEvent(booking, day, nextDay, instrument.name));
      }
    }
    grid.append(cell);
  }
  calendar.replaceChildren(headings, grid);
}

function renderCalendar(days, resetScroll) {
  const previousScroll = calendar.scrollTop;
  const previousLeft = calendar.scrollLeft;
  const bookings = state.allInstruments ? state.bookings
    : state.bookings.filter((booking) => booking.instrument_ids.includes(state.activeId));
  calendar.dataset.view = state.view;
  if (isOverview(state.view)) renderMonth(days, bookings);
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

function choice(name, value, text, checked) {
  const label = element("label", "choice");
  const input = element("input");
  input.type = "checkbox";
  input.name = name;
  input.value = value;
  input.checked = checked;
  label.append(input, element("span", "", text));
  return label;
}

function updateEmployeeChoices() {
  const list = $("#booking-employees");
  const labId = Number(bookingLab.value);
  for (const group of list.querySelectorAll("[data-lab]")) {
    group.hidden = labId !== 0 && Number(group.dataset.lab) !== labId;
  }
  $("#no-employees").hidden = Boolean(list.querySelector("[data-lab]:not([hidden])"));
  const names = Array.from(list.querySelectorAll("input:checked"), (input) => input.nextElementSibling.textContent);
  const selection = $("#employee-selection");
  selection.textContent = names.length ? `Выбраны ${names.join(", ")}` : "";
  selection.hidden = names.length === 0;
}

function fillBookingChoices(booking) {
  const instrumentIds = booking?.instrument_ids ?? [state.activeId];
  $("#booking-instruments").replaceChildren(...state.instruments.map(({ id, name }) =>
    choice("instrument_ids", id, name, instrumentIds.includes(id))));
  bookingLab.replaceChildren(new Option("Все лаборатории", 0), ...state.labs.map(({ id, name }) => new Option(name, id)));

  const employeeIds = booking?.employee_ids ?? [];
  const groups = [];
  for (const lab of state.labs) {
    const members = state.employees.filter(({ lab_id }) => lab_id === lab.id);
    if (!members.length) continue;
    const group = element("div", "employee-group");
    group.dataset.lab = lab.id;
    group.append(element("h3", "", lab.name), ...members.map(({ id, name }) =>
      choice("employee_ids", id, name, employeeIds.includes(id))));
    groups.push(group);
  }
  const empty = element("p", "selection", "Список пуст. Добавьте сотрудников в разделе «Лаборатории и сотрудники».");
  empty.id = "no-employees";
  $("#booking-employees").replaceChildren(...groups, empty);
  updateEmployeeChoices();
}

function resetEmployeeForm() {
  state.editingEmployeeId = null;
  employeeForm.reset();
  formError(employeeForm);
  $("#save-employee").textContent = "Добавить";
  $("#cancel-employee-edit").hidden = true;
}

function renderDirectoryEmployees() {
  const list = $("#directory-employees");
  const employees = state.employees.filter(({ lab_id }) => lab_id === Number(directoryLab.value));
  const items = employees.map((employee) => {
    const row = element("div", "directory-employee");
    const edit = element("button", "button", "Изменить");
    edit.type = "button";
    edit.setAttribute("aria-label", `Изменить имя сотрудника ${employee.name}`);
    edit.addEventListener("click", () => {
      state.editingEmployeeId = employee.id;
      const input = employeeForm.elements.namedItem("name");
      input.value = employee.name;
      $("#save-employee").textContent = "Сохранить";
      $("#cancel-employee-edit").hidden = false;
      formError(employeeForm);
      input.focus();
      input.select();
    });
    row.append(element("span", "", employee.name), edit);
    return row;
  });
  list.replaceChildren(...(items.length ? items : [element("p", "selection", "Список пока пуст.")]));
}

function selectDirectoryLab() {
  const lab = state.labs.find(({ id }) => id === Number(directoryLab.value));
  labForm.elements.namedItem("name").value = lab?.name ?? "";
  formError(labForm);
  resetEmployeeForm();
  renderDirectoryEmployees();
}

function fillDirectoryLabs() {
  const labId = directoryLab.value;
  directoryLab.replaceChildren(...state.labs.map(({ id, name }) => new Option(name, id)));
  if (labId) directoryLab.value = labId;
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
  fillBookingChoices(booking);
  fields.start.value = start;
  fields.end.value = booking?.end || nextHour;
  fields.person.value = booking?.person || "";
  fields.comment.value = booking?.comment || "";
  formError(bookingForm);
  bookingDialog.showModal();
}

$("#instruments").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button || button.getAttribute("aria-pressed") === "true") return;
  state.allInstruments = button.dataset.id === "all";
  if (state.allInstruments) {
    setView(isOverview(state.view) ? state.view : "month");
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
$("#manage-directory").addEventListener("click", () => {
  fillDirectoryLabs();
  selectDirectoryLab();
  directoryDialog.showModal();
});
directoryLab.addEventListener("change", selectDirectoryLab);
$("#cancel-employee-edit").addEventListener("click", resetEmployeeForm);
bookingLab.addEventListener("change", updateEmployeeChoices);
$("#booking-employees").addEventListener("change", updateEmployeeChoices);
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
      : addDays(state.date, direction * (state.view === "day" ? 1 : 7));
    refreshCalendar(isOverview(state.view));
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
    if (dialog.querySelector("form[data-pending]")) event.preventDefault();
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

labForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(labForm, async () => {
    const lab = await api(`labs/${directoryLab.value}`, "PUT", { name: labForm.elements.namedItem("name").value });
    state.labs = state.labs.map((item) => item.id === lab.id ? lab : item);
    fillDirectoryLabs();
    if (Number(directoryLab.value) === lab.id) labForm.elements.namedItem("name").value = lab.name;
  });
});

employeeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(employeeForm, async () => {
    const id = state.editingEmployeeId;
    const payload = { lab_id: Number(directoryLab.value), name: employeeForm.elements.namedItem("name").value };
    const employee = await api(id === null ? "employees" : `employees/${id}`, id === null ? "POST" : "PUT", payload);
    state.employees = [...state.employees.filter((item) => item.id !== employee.id), employee]
      .sort((first, second) => first.name.localeCompare(second.name, "ru"));
    resetEmployeeForm();
    renderDirectoryEmployees();
    if (id !== null) refreshCalendar();
  });
});

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(bookingForm, async () => {
    const fields = new FormData(bookingForm);
    const payload = Object.fromEntries(fields);
    payload.instrument_ids = fields.getAll("instrument_ids").map(Number);
    payload.employee_ids = fields.getAll("employee_ids").map(Number);
    const editing = state.editingId !== null;
    const booking = await api(editing ? `bookings/${state.editingId}` : "bookings", editing ? "PUT" : "POST", payload);
    if (!booking.instrument_ids.includes(state.activeId)) state.activeId = booking.instrument_ids[0];
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
    const [instruments, directory] = await Promise.all([api("instruments"), api("directory")]);
    state.instruments = instruments;
    state.labs = directory.labs;
    state.employees = directory.employees;
    $("#manage-directory").disabled = false;
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
