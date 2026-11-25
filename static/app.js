"use strict";

const $ = (selector) => document.querySelector(selector);
const calendar = $("#calendar");
const datePicker = $("#calendar-date");
const dateTimePicker = $("#date-time-picker");
const pickerTriggers = Array.from(document.querySelectorAll("[data-pick]"));
const pickerTimeInput = $("#picker-exact-time");
const instrumentDialog = $("#instrument-dialog");
const instrumentForm = $("#instrument-form");
const instrumentName = instrumentForm.elements.namedItem("name");
const renameInstrument = $("#rename-instrument");
const dayBookingsDialog = $("#day-bookings-dialog");
const directoryDialog = $("#directory-dialog");
const resonatorDialog = $("#resonator-dialog");
const resonatorForm = $("#resonator-form");
const directoryLab = $("#directory-lab");
const labForm = $("#lab-form");
const employeeForm = $("#employee-form");
const bookingLab = $("#booking-lab");
const bookingDialog = $("#booking-dialog");
const bookingForm = $("#booking-form");
const bookingStart = bookingForm.elements.start;
const bookingEnd = bookingForm.elements.end;
const cancelBookingButton = $("#cancel-booking");
const weekdayFormat = new Intl.DateTimeFormat("ru", { weekday: "short" });
const dayFormat = new Intl.DateTimeFormat("ru", { dateStyle: "full" });
const rangeFormat = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("ru", { month: "long", year: "numeric" });
const shortDateFormat = new Intl.DateTimeFormat("ru", { dateStyle: "short" });
const hues = [145, 183, 268, 23, 332, 45, 216];

const state = {
  date: new Date(),
  view: "month",
  instruments: [],
  resonators: [],
  labs: [],
  employees: [],
  activeId: null,
  allInstruments: false,
  bookings: [],
  editingInstrumentId: null,
  editingEmployeeId: null,
  editingResonatorId: null,
  editingId: null,
  requestId: 0,
};

const picker = { input: null, withTime: false, day: "", month: null, time: "" };

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

function setDateControl(input, value) {
  input.value = value;
  const trigger = pickerTriggers.find((button) => button.dataset.pick === input.id);
  const date = value ? shortDateFormat.format(fromKey(value.slice(0, 10))) : "";
  const text = date && value.length > 10 ? `${date}, ${value.slice(11, 16)}` : date;
  trigger.textContent = text || trigger.dataset.label;
  trigger.setAttribute("aria-label", text ? `${trigger.dataset.label}, ${text}` : trigger.dataset.label);
}

function pickerError(message = "") {
  const error = $("#picker-error");
  error.textContent = message;
  error.hidden = !message;
}

function renderPickerDays() {
  const minimum = picker.input.dataset.min?.slice(0, 10);
  const currentMonth = dateKey(picker.month).slice(0, 7);
  const next = firstOfMonth(picker.month, 1);
  const count = addDays(next, -1).getDate();
  const today = dateKey(new Date());
  $("#picker-month").textContent = monthFormat.format(picker.month);
  $("#picker-previous").disabled = picker.month.getFullYear() === 1 && picker.month.getMonth() === 0
    || Boolean(minimum && currentMonth <= minimum.slice(0, 7));
  $("#picker-next").disabled = next.getFullYear() > 9999;

  const days = Array.from({ length: mondayOffset(picker.month) }, () => element("span"));
  for (let index = 0; index < count; index += 1) {
    const date = addDays(picker.month, index);
    const day = dateKey(date);
    const button = element("button", day === today ? "picker-option picker-today" : "picker-option", String(index + 1));
    button.type = "button";
    button.dataset.pickerDay = day;
    button.disabled = Boolean(minimum && day < minimum);
    button.setAttribute("aria-label", dayFormat.format(date));
    button.setAttribute("aria-pressed", String(day === picker.day));
    days.push(button);
  }
  $("#picker-days").replaceChildren(...days);
}

function renderPickerTimes() {
  const minimum = picker.input.dataset.min;
  const buttons = Array.from({ length: 48 }, (_, index) => {
    const time = `${pad(Math.floor(index / 2))}:${index % 2 ? "30" : "00"}`;
    const button = element("button", "picker-option", time);
    button.type = "button";
    button.dataset.pickerTime = time;
    button.disabled = Boolean(minimum && `${picker.day}T${time}` < minimum);
    button.setAttribute("aria-pressed", String(time === picker.time));
    return button;
  });
  const list = $("#picker-times");
  list.replaceChildren(...buttons);
  const current = buttons.find((button) => button.dataset.pickerTime >= picker.time && !button.disabled);
  list.scrollTop = current ? Math.max(0, current.offsetTop - list.clientHeight / 2) : list.scrollHeight;
}

function acceptPickerValue(value) {
  if (picker.input.dataset.min && value < picker.input.dataset.min) {
    pickerError("Окончание должно быть позже начала.");
    return;
  }
  setDateControl(picker.input, value);
  dateTimePicker.close();
  picker.input.dispatchEvent(new Event("change", { bubbles: true }));
}

function openDateTimePicker(trigger) {
  picker.input = document.getElementById(trigger.dataset.pick);
  picker.withTime = trigger.hasAttribute("data-time");
  const value = picker.input.value || picker.input.dataset.min || dateKey(new Date());
  picker.day = value.slice(0, 10);
  picker.month = firstOfMonth(fromKey(picker.day));
  picker.time = value.slice(11, 16) || "09:00";
  $("#picker-title").textContent = trigger.dataset.label;
  $("#picker-time-fields").hidden = !picker.withTime;
  pickerTimeInput.value = picker.time;
  pickerError();
  renderPickerDays();
  dateTimePicker.showModal();
  if (picker.withTime) renderPickerTimes();
  $("#picker-days button[aria-pressed='true']:not(:disabled)")?.focus();
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

function instrumentNames(booking) {
  return booking.instrument_ids.map((id) => state.instruments.find((item) => item.id === id)?.name).filter(Boolean).join(" + ");
}

function openDayBookings(name, day, nextDay, bookings) {
  $("#day-bookings-title").textContent = name;
  $("#day-bookings-date").textContent = dayFormat.format(fromKey(day));
  const entries = bookings.map((booking) => {
    const label = daySegment(booking, day, nextDay).label;
    const item = element("button", "button day-booking", `${label} · ${instrumentNames(booking)} · ${bookingPeople(booking)}`);
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

function weekSpans(week, bookings) {
  const groups = new Map();
  for (const booking of bookings) {
    const columns = week.flatMap((day, index) => day && booking.start < `${day.next}T00:00`
      && booking.end > `${day.key}T00:00` ? [index] : []);
    if (!columns.length) continue;
    const first = columns[0];
    const last = columns.at(-1);
    const singleDay = first === last && booking.start >= `${week[first].key}T00:00` && booking.end <= `${week[last].next}T00:00`;
    const key = state.allInstruments && singleDay
      ? `${first}:${[...booking.instrument_ids].sort((firstId, secondId) => firstId - secondId).join(",")}` : booking.id;
    if (!groups.has(key)) groups.set(key, { first, last, bookings: [] });
    groups.get(key).bookings.push(booking);
  }
  return Array.from(groups.values()).sort((first, second) => first.first - second.first || second.last - first.last);
}

function stripeBackground(instrumentIds) {
  const colors = instrumentIds.map((id) => `hsl(${instrumentColor(id)} 75% 29%)`);
  if (colors.length === 1) return colors[0];
  const bands = colors.map((color, index) => `${color} ${index * 12}px ${(index + 1) * 12}px`);
  return `repeating-linear-gradient(135deg, ${bands.join(", ")})`;
}

function renderSpan(span, week, lane, labeled) {
  const { first, last, bookings } = span;
  const booking = bookings[0];
  const { key, next } = week[first];
  const name = instrumentNames(booking);
  const item = element("button", "overview-booking");
  item.type = "button";
  item.style.gridColumn = `${first + 1} / ${last + 2}`;
  item.style.gridRow = String(lane + 1);
  item.style.background = stripeBackground(booking.instrument_ids);
  item.classList.toggle("continues-previous", booking.start < `${key}T00:00`);
  item.classList.toggle("continues-next", booking.end > `${week[last].next}T00:00`);
  item.title = `${name} (${bookings.map((entry) => `${bookingPeople(entry)} · ${dateAndClock(entry.start)}–${dateAndClock(entry.end)}`).join("; ")})`;
  if (!labeled.has(booking.id)) {
    const people = bookingPeople(booking);
    const long = first !== last || booking.start < `${key}T00:00` || booking.end > `${next}T00:00`;
    const label = long ? people : `${daySegment(booking, key, next).label.replaceAll(":00", "")} · ${people}`;
    item.append(element("span", "overview-name", `${name} (${label})`));
    for (const entry of bookings) labeled.add(entry.id);
  }
  if (bookings.length === 1) {
    item.dataset.booking = booking.id;
    item.setAttribute("aria-label", `${item.title}. Открыть бронь`);
  } else {
    item.append(element("span", "overview-count", String(bookings.length)));
    item.setAttribute("aria-label", `${item.title}. Открыть список броней`);
    item.addEventListener("click", () => openDayBookings(name, key, next, bookings));
  }
  return item;
}

function renderMonthWeek(week, bookings, today, labeled) {
  const row = element("div", "month-week");
  const bars = element("div", "month-bars");
  const overflow = week.map(() => []);
  const occupiedUntil = Array(7).fill(-1);
  for (const span of weekSpans(week, bookings)) {
    const lane = occupiedUntil.findIndex((last) => last < span.first);
    if (lane < 0) {
      for (let column = span.first; column <= span.last; column += 1) overflow[column].push(...span.bookings);
    } else {
      occupiedUntil[lane] = span.last;
      bars.append(renderSpan(span, week, lane, labeled));
    }
  }

  for (const [column, day] of week.entries()) {
    const cell = element("div", "month-cell");
    if (!day) {
      cell.classList.add("outside-month");
      cell.setAttribute("aria-hidden", "true");
    } else {
      const { key, next, label, date } = day;
      cell.classList.toggle("today", key === today);
      cell.dataset.day = key;
      const dayButton = element("button", "month-date", label);
      dayButton.type = "button";
      dayButton.setAttribute("aria-label", `${dayFormat.format(date)}. Создать бронь`);
      cell.append(dayButton);
      if (overflow[column].length) {
        const extra = element("button", "month-more", `+${overflow[column].length}`);
        extra.type = "button";
        extra.setAttribute("aria-label", "Показать остальные брони за день");
        extra.addEventListener("click", () => openDayBookings("Другие брони", key, next, overflow[column]));
        cell.append(extra);
      }
    }
    row.append(cell);
  }
  row.append(bars);
  return row;
}

function renderMonth(days, bookings) {
  const headings = element("div", "month-headings");
  const grid = element("div", "month-grid");
  const today = dateKey(new Date());
  const offset = mondayOffset(days[0]);
  const monday = addDays(days[0], -offset);
  for (let index = 0; index < 7; index += 1) {
    headings.append(element("div", "date-heading", weekdayFormat.format(addDays(monday, index))));
  }

  const labeled = new Set();
  for (let start = -offset; start < days.length; start += 7) {
    const week = Array.from({ length: 7 }, (_, column) => {
      const index = start + column;
      const date = days[index];
      if (!date) return null;
      const key = dateKey(date);
      const next = dateKey(addDays(date, 1));
      const withMonth = state.view === "rolling" && (index === 0 || date.getDate() === 1);
      const label = withMonth ? `${pad(date.getDate())}.${pad(date.getMonth() + 1)}` : String(date.getDate());
      return { key, next, label, date };
    });
    grid.append(renderMonthWeek(week, bookings, today, labeled));
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
  setDateControl(datePicker, dateKey(state.date));
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
  const resonators = state.instruments.map(({ id, name }) => {
    const label = element("label", "", name);
    const select = element("select");
    select.dataset.instrument = id;
    select.append(new Option("Без резонатора", ""), ...state.resonators.map((item) => new Option(item.name, item.id)));
    select.value = booking?.resonators?.[id] ?? "";
    label.append(select);
    return label;
  });
  $("#booking-resonators").replaceChildren(...resonators);
  updateResonatorChoices();
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

function updateResonatorChoices() {
  const selected = new Set(Array.from($("#booking-instruments").querySelectorAll("input:checked"), (input) => input.value));
  for (const select of $("#booking-resonators").querySelectorAll("select")) {
    select.disabled = !selected.has(select.dataset.instrument);
    select.parentElement.hidden = select.disabled;
  }
  $("#booking-resonator-fields").hidden = !state.resonators.length || !selected.size;
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

function resetResonatorForm() {
  state.editingResonatorId = null;
  resonatorForm.reset();
  formError(resonatorForm);
  $("#save-resonator").textContent = "Добавить";
  $("#cancel-resonator-edit").hidden = true;
}

function renderResonators() {
  const items = state.resonators.map(({ id, name }) => {
    const row = element("div", "directory-employee");
    const edit = element("button", "button", "Изменить");
    edit.type = "button";
    edit.setAttribute("aria-label", `Переименовать резонатор ${name}`);
    edit.addEventListener("click", () => {
      state.editingResonatorId = id;
      const input = resonatorForm.elements.namedItem("name");
      input.value = name;
      $("#save-resonator").textContent = "Сохранить";
      $("#cancel-resonator-edit").hidden = false;
      formError(resonatorForm);
      input.focus();
      input.select();
    });
    row.append(element("span", "", name), edit);
    return row;
  });
  $("#resonator-list").replaceChildren(...(items.length ? items : [element("p", "selection", "Список пока пуст.")]));
}

function shiftTime(value, milliseconds) {
  const time = new Date(Date.parse(`${value}Z`) + milliseconds);
  return Number.isNaN(time.getTime()) || time.getUTCFullYear() > 9999 ? "" : time.toISOString().slice(0, 16);
}

function openBookingForm(booking, slotStart) {
  if (state.activeId === null) return;
  const start = booking?.start || slotStart || `${dateKey(state.date)}T09:00`;
  const workdayEnd = `${start.slice(0, 10)}T20:00`;
  const end = booking?.end ?? (start < workdayEnd ? workdayEnd : shiftTime(start, 3600000));
  const fields = bookingForm.elements;
  state.editingId = booking?.id ?? null;
  $("#booking-dialog-title").textContent = booking ? "Изменить бронь" : "Новая бронь";
  cancelBookingButton.hidden = !booking;
  fillBookingChoices(booking);
  setDateControl(bookingStart, start);
  bookingStart.dataset.initial = start;
  bookingEnd.dataset.min = shiftTime(start, 60000);
  setDateControl(bookingEnd, end);
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
$("#manage-resonators").addEventListener("click", () => {
  resetResonatorForm();
  renderResonators();
  resonatorDialog.showModal();
});
$("#cancel-resonator-edit").addEventListener("click", resetResonatorForm);
$("#booking-instruments").addEventListener("change", updateResonatorChoices);
bookingStart.addEventListener("change", () => {
  const start = bookingStart.value;
  if (!start) return;
  const duration = Date.parse(`${bookingEnd.value}Z`) - Date.parse(`${bookingStart.dataset.initial}Z`);
  bookingEnd.dataset.min = shiftTime(start, 60000);
  setDateControl(bookingEnd, shiftTime(start, duration > 0 ? duration : 3600000));
  bookingStart.dataset.initial = start;
});
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
  if (button.classList.contains("month-date") && (event.detail === 0 || event.pointerType === "touch")) {
    openBookingForm(null, `${button.parentElement.dataset.day}T09:00`);
  }
});
calendar.addEventListener("dblclick", (event) => {
  if (event.target.closest("button:not(.month-date)")) return;
  const day = event.target.closest("[data-day]")?.dataset.day;
  if (day) openBookingForm(null, `${day}T09:00`);
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

for (const trigger of pickerTriggers) {
  trigger.addEventListener("click", () => openDateTimePicker(trigger));
}
for (const [selector, delta] of [["#picker-previous", -1], ["#picker-next", 1]]) {
  $(selector).addEventListener("click", () => {
    picker.month = firstOfMonth(picker.month, delta);
    renderPickerDays();
  });
}
$("#picker-days").addEventListener("click", (event) => {
  const button = event.target.closest("[data-picker-day]");
  if (!button) return;
  picker.day = button.dataset.pickerDay;
  if (!picker.withTime) {
    acceptPickerValue(picker.day);
    return;
  }
  $("#picker-days button[aria-pressed='true']")?.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-pressed", "true");
  pickerError();
  renderPickerTimes();
});
$("#picker-times").addEventListener("click", (event) => {
  const button = event.target.closest("[data-picker-time]");
  if (button && !button.disabled) acceptPickerValue(`${picker.day}T${button.dataset.pickerTime}`);
});
$("#picker-exact").addEventListener("submit", (event) => {
  event.preventDefault();
  const match = /^([0-9]{1,2}):?([0-9]{2})$/.exec(pickerTimeInput.value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    pickerError("Введите время в формате ЧЧ:ММ.");
    return;
  }
  acceptPickerValue(`${picker.day}T${pad(Number(match[1]))}:${match[2]}`);
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

resonatorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(resonatorForm, async () => {
    const id = state.editingResonatorId;
    const payload = { name: resonatorForm.elements.namedItem("name").value };
    const item = await api(id === null ? "resonators" : `resonators/${id}`, id === null ? "POST" : "PUT", payload);
    if (id === null) state.resonators.push(item);
    else state.resonators = state.resonators.map((resonator) => resonator.id === item.id ? item : resonator);
    resetResonatorForm();
    renderResonators();
  });
});

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(bookingForm, async () => {
    const fields = new FormData(bookingForm);
    const payload = Object.fromEntries(fields);
    payload.instrument_ids = fields.getAll("instrument_ids").map(Number);
    payload.employee_ids = fields.getAll("employee_ids").map(Number);
    const resonators = Array.from($("#booking-resonators").querySelectorAll("select:not(:disabled)"));
    payload.resonators = Object.fromEntries(resonators.filter((select) => select.value)
      .map((select) => [select.dataset.instrument, Number(select.value)]));
    const editing = state.editingId !== null;
    const booking = await api(editing ? `bookings/${state.editingId}` : "bookings", editing ? "PUT" : "POST", payload);
    if (!booking.instrument_ids.includes(state.activeId)) state.activeId = booking.instrument_ids[0];
    state.date = fromKey(booking.start.slice(0, 10));
    renderInstruments();
    bookingDialog.close();
    refreshCalendar();
  });
});

cancelBookingButton.addEventListener("click", () => {
  if (!window.confirm("Отменить эту бронь?")) return;
  submit(bookingForm, async () => {
    await api(`bookings/${state.editingId}`, "DELETE");
    bookingDialog.close();
    refreshCalendar();
  });
});

async function start() {
  $("#new-instrument").disabled = true;
  try {
    const [instruments, directory, resonators] = await Promise.all([api("instruments"), api("directory"), api("resonators")]);
    state.instruments = instruments;
    state.resonators = resonators;
    state.labs = directory.labs;
    state.employees = directory.employees;
    $("#manage-directory").disabled = false;
    $("#manage-resonators").disabled = false;
    state.activeId = state.instruments[0]?.id ?? null;
    state.allInstruments = state.activeId !== null;
    renderInstruments();
  } catch (error) {
    setStatus(error.message);
  } finally {
    $("#new-instrument").disabled = false;
    refreshCalendar(true);
  }
}

start();
