const API = {
  geocoding: "https://geocoding-api.open-meteo.com/v1/search",
  forecast: "https://api.open-meteo.com/v1/forecast",
};

const weatherTypes = [
  { codes: [0], description: "Sunny", icon: "sunny" },
  { codes: [1, 2], description: "Partly cloudy", icon: "partly-cloudy" },
  { codes: [3], description: "Overcast", icon: "overcast" },
  { codes: [45, 48], description: "Foggy", icon: "fog" },
  { codes: [51, 53, 55, 56, 57], description: "Drizzle", icon: "drizzle" },
  { codes: [61, 63, 65, 66, 67, 80, 81, 82], description: "Rainy", icon: "rain" },
  { codes: [71, 73, 75, 77, 85, 86], description: "Snowy", icon: "snow" },
  { codes: [95, 96, 99], description: "Thunderstorms", icon: "storm" },
];

const elements = {
  form: document.querySelector("#search-form"),
  search: document.querySelector("#location-search"),
  searchResults: document.querySelector("#search-results"),
  searchMessage: document.querySelector("#search-message"),
  map: document.querySelector("#world-map"),
  mapMessage: document.querySelector("#map-message"),
  loading: document.querySelector("#loading-state"),
  error: document.querySelector("#error-state"),
  errorMessage: document.querySelector("#error-message"),
  retry: document.querySelector("#retry-button"),
  weather: document.querySelector("#weather-layout"),
  unitsTrigger: document.querySelector("#units-trigger"),
  unitsMenu: document.querySelector("#units-menu"),
  systemToggle: document.querySelector("#system-toggle"),
  daySelector: document.querySelector("#day-selector"),
  dailyForecast: document.querySelector("#daily-forecast"),
  hourlyForecast: document.querySelector("#hourly-forecast"),
};

const state = {
  location: null,
  forecast: null,
  units: { temperature: "fahrenheit", wind: "mph", precipitation: "in" },
  selectedDay: 0,
  weatherController: null,
  geocodingController: null,
  suggestionTimer: null,
  searchResults: [],
  map: null,
  mapMarker: null,
};

const iconPath = (name) => `./assets/images/icon-${name}.webp`;

function getWeatherType(code) {
  return weatherTypes.find((type) => type.codes.includes(code)) ?? weatherTypes[2];
}

function getTemperature(value) {
  const temperature = state.units.temperature === "fahrenheit" ? (value * 9) / 5 + 32 : value;
  return `${Math.round(temperature)}°`;
}

function getWindSpeed(value) {
  const speed = state.units.wind === "mph" ? value / 1.609344 : value;
  const unit = state.units.wind === "kmh" ? "km/h" : "mph";
  return `${Math.round(speed)} ${unit}`;
}

function getPrecipitation(value) {
  const amount = state.units.precipitation === "in" ? value / 25.4 : value;
  return `${amount < 1 && amount > 0 ? amount.toFixed(1) : Math.round(amount)} ${state.units.precipitation}`;
}

function showLoading() {
  elements.loading.hidden = false;
  elements.error.hidden = true;
  elements.weather.hidden = true;
  elements.searchMessage.textContent = "";
}

function showError(message) {
  elements.loading.hidden = true;
  elements.weather.hidden = true;
  elements.error.hidden = false;
  elements.errorMessage.textContent = message;
}

function getLocationName(location) {
  if (location.isMapPoint) {
    return `Map location (${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)})`;
  }

  const city = location.name;
  const region = location.admin1 && location.admin1 !== city ? location.admin1 : "";
  const country = location.country;
  const details = [region, country].filter(Boolean).join(", ");
  return details ? `${city}, ${details}` : city;
}

function initializeMap() {
  if (!window.L) {
    elements.mapMessage.textContent = "The map couldn't be loaded. You can still search for places above.";
    return;
  }

  state.map = window.L.map(elements.map, {
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 18,
    scrollWheelZoom: false,
  }).setView([20, 0], 2);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(state.map);

  state.map.on("click", ({ latlng }) => {
    loadWeather({
      name: "Map location",
      latitude: latlng.lat,
      longitude: latlng.lng,
      isMapPoint: true,
    });
  });
}

function moveMapToLocation(location) {
  if (!state.map) return;

  const coordinates = [location.latitude, location.longitude];
  if (!state.mapMarker) {
    state.mapMarker = window.L.marker(coordinates).addTo(state.map);
  } else {
    state.mapMarker.setLatLng(coordinates);
  }
  state.mapMarker.bindPopup(getLocationName(location));
  state.map.flyTo(coordinates, Math.max(state.map.getZoom(), 5), { duration: 0.8 });
  elements.mapMessage.textContent = `Showing weather for ${getLocationName(location)}. Select another spot to explore.`;
}

function formatDate(dateString, options) {
  return new Intl.DateTimeFormat("en", options).format(new Date(`${dateString}T12:00:00`));
}

function renderCurrentWeather() {
  const { current } = state.forecast;
  const condition = getWeatherType(current.weather_code);
  const timeZone = state.forecast.timezone;
  const localDate = current.time.slice(0, 10);
  const readableDate = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  document.querySelector("#location-name").textContent = getLocationName(state.location);
  document.querySelector("#current-date").textContent = readableDate;
  const currentIcon = document.querySelector("#current-icon");
  currentIcon.src = iconPath(condition.icon);
  currentIcon.alt = condition.description;
  document.querySelector("#current-temperature").textContent = getTemperature(current.temperature_2m);
  document.querySelector("#feels-like").textContent = getTemperature(current.apparent_temperature);
  document.querySelector("#humidity").textContent = `${current.relative_humidity_2m}%`;
  document.querySelector("#wind-speed").textContent = getWindSpeed(current.wind_speed_10m);
  document.querySelector("#precipitation").textContent = getPrecipitation(current.precipitation);
  state.currentDate = localDate;
}

function renderDailyForecast() {
  const daily = state.forecast.daily;
  elements.dailyForecast.replaceChildren();
  daily.time.forEach((date, index) => {
    const condition = getWeatherType(daily.weather_code[index]);
    const day = document.createElement("article");
    day.className = "daily-card";
    day.innerHTML = `
      <h3>${index === 0 ? "Today" : formatDate(date, { weekday: "short" })}</h3>
      <img src="${iconPath(condition.icon)}" alt="${condition.description}" />
      <div class="daily-temperatures">
        <span>${getTemperature(daily.temperature_2m_max[index])}</span>
        <span>${getTemperature(daily.temperature_2m_min[index])}</span>
      </div>
    `;
    elements.dailyForecast.append(day);
  });
}

function getHourlyIndices(dayIndex) {
  const { hourly, daily } = state.forecast;
  const date = daily.time[dayIndex];
  const indices = hourly.time.reduce((matches, time, index) => {
    if (time.startsWith(date)) matches.push(index);
    return matches;
  }, []);

  if (dayIndex !== 0 || !state.currentDate || date !== state.currentDate) {
    return indices.filter((index) => Number(hourly.time[index].slice(11, 13)) >= 9).slice(0, 8);
  }

  const localHour = Number(state.forecast.current.time.slice(11, 13));
  const nextHours = indices.filter((index) => Number(hourly.time[index].slice(11, 13)) >= localHour);
  return (nextHours.length ? nextHours : indices).slice(0, 8);
}

function renderHourlyForecast() {
  const { hourly } = state.forecast;
  const indices = getHourlyIndices(state.selectedDay);
  elements.hourlyForecast.replaceChildren();

  indices.forEach((index) => {
    const time = hourly.time[index];
    const condition = getWeatherType(hourly.weather_code[index]);
    const hour = Number(time.slice(11, 13));
    const label = `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
    const row = document.createElement("article");
    row.className = "hourly-card";
    row.innerHTML = `
      <img src="${iconPath(condition.icon)}" alt="${condition.description}" />
      <time datetime="${time}">${label}</time>
      <p>${getTemperature(hourly.temperature_2m[index])}</p>
    `;
    elements.hourlyForecast.append(row);
  });
}

function renderDays() {
  const daily = state.forecast.daily;
  elements.daySelector.replaceChildren();
  daily.time.forEach((date, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent =
      index === 0 ? "Today" : formatDate(date, { weekday: "long" });
    elements.daySelector.append(option);
  });
  elements.daySelector.value = String(state.selectedDay);
}

function renderWeather() {
  renderCurrentWeather();
  renderDailyForecast();
  renderDays();
  renderHourlyForecast();
  elements.loading.hidden = true;
  elements.error.hidden = true;
  elements.weather.hidden = false;
}

async function loadWeather(location) {
  state.weatherController?.abort();
  state.weatherController = new AbortController();
  state.location = location;
  moveMapToLocation(location);
  showLoading();

  const parameters = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: "7",
    timezone: "auto",
  });

  try {
    const response = await fetch(`${API.forecast}?${parameters}`, {
      signal: state.weatherController.signal,
    });
    if (!response.ok) throw new Error("Weather data is temporarily unavailable.");
    const forecast = await response.json();
    if (!forecast.current || !forecast.daily || !forecast.hourly) {
      throw new Error("The weather service returned incomplete data. Please try again.");
    }

    state.forecast = forecast;
    state.selectedDay = 0;
    renderWeather();
  } catch (error) {
    if (error.name === "AbortError") return;
    showError(error.message || "We couldn't load the weather. Please try again.");
  }
}

async function searchLocations(query, { submitFirst = false } = {}) {
  state.geocodingController?.abort();
  state.geocodingController = new AbortController();
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    elements.searchMessage.textContent = "Enter a city or place to search.";
    closeSearchResults();
    return;
  }

  elements.searchMessage.textContent = "";
  const parameters = new URLSearchParams({
    name: trimmedQuery,
    count: "10",
    language: "en",
    format: "json",
  });

  try {
    const response = await fetch(`${API.geocoding}?${parameters}`, {
      signal: state.geocodingController.signal,
    });
    if (!response.ok) throw new Error("Location search is temporarily unavailable.");
    const data = await response.json();
    const locations = data.results ?? [];
    state.searchResults = locations;

    if (locations.length === 0) {
      elements.searchMessage.textContent = `No locations found for “${trimmedQuery}”. Try another search.`;
      closeSearchResults();
      return;
    }

    if (submitFirst) {
      closeSearchResults();
      elements.search.value = getLocationName(locations[0]);
      await loadWeather(locations[0]);
      return;
    }

    renderSearchResults(locations);
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.searchMessage.textContent = error.message || "Location search failed. Please try again.";
  }
}

function renderSearchResults(locations) {
  elements.searchResults.replaceChildren();
  locations.forEach((location, index) => {
    const button = document.createElement("button");
    button.className = "search-result";
    button.type = "button";
    button.role = "option";
    button.setAttribute("aria-selected", "false");
    button.textContent = getLocationName(location);
    button.addEventListener("click", () => selectLocation(index));
    elements.searchResults.append(button);
  });
  elements.searchResults.hidden = false;
}

function closeSearchResults() {
  elements.searchResults.hidden = true;
}

async function selectLocation(index) {
  const location = state.searchResults[index];
  if (!location) return;
  elements.search.value = getLocationName(location);
  closeSearchResults();
  await loadWeather(location);
}

function setUnits(units) {
  state.units = { ...units };
  document.querySelectorAll(".units-menu [data-setting]").forEach((button) => {
    const selected = state.units[button.dataset.setting] === button.dataset.value;
    button.setAttribute("aria-pressed", String(selected));
  });

  const metric =
    state.units.temperature === "celsius" &&
    state.units.wind === "kmh" &&
    state.units.precipitation === "mm";
  elements.systemToggle.textContent = `Switch to ${metric ? "Imperial" : "Metric"}`;
  if (state.forecast) renderWeather();
}

function toggleUnitsMenu(forceOpen) {
  const shouldOpen = forceOpen ?? elements.unitsMenu.hidden;
  elements.unitsMenu.hidden = !shouldOpen;
  elements.unitsTrigger.setAttribute("aria-expanded", String(shouldOpen));
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(state.suggestionTimer);
  searchLocations(elements.search.value, { submitFirst: true });
});

elements.search.addEventListener("input", () => {
  clearTimeout(state.suggestionTimer);
  if (!elements.search.value.trim()) {
    closeSearchResults();
    elements.searchMessage.textContent = "";
    return;
  }
  state.suggestionTimer = setTimeout(() => searchLocations(elements.search.value), 250);
});

elements.search.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSearchResults();
  if (event.key === "ArrowDown" && !elements.searchResults.hidden) {
    event.preventDefault();
    elements.searchResults.querySelector("button")?.focus();
  }
});

elements.searchResults.addEventListener("keydown", (event) => {
  const options = [...elements.searchResults.querySelectorAll("button")];
  const currentIndex = options.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const nextIndex =
      event.key === "ArrowDown"
        ? (currentIndex + 1) % options.length
        : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
  }
  if (event.key === "Escape") {
    closeSearchResults();
    elements.search.focus();
  }
});

elements.unitsTrigger.addEventListener("click", () => toggleUnitsMenu());
elements.unitsMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-setting]");
  if (!button) return;
  setUnits({ ...state.units, [button.dataset.setting]: button.dataset.value });
});
elements.systemToggle.addEventListener("click", () => {
  const metric =
    state.units.temperature === "celsius" &&
    state.units.wind === "kmh" &&
    state.units.precipitation === "mm";
  setUnits(
    metric
      ? { temperature: "fahrenheit", wind: "mph", precipitation: "in" }
      : { temperature: "celsius", wind: "kmh", precipitation: "mm" },
  );
});
elements.daySelector.addEventListener("change", () => {
  state.selectedDay = Number(elements.daySelector.value);
  renderHourlyForecast();
});
elements.retry.addEventListener("click", () => {
  if (state.location) loadWeather(state.location);
  else loadWeather({ name: "Berlin", latitude: 52.52, longitude: 13.405, country: "Germany" });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".units-control")) toggleUnitsMenu(false);
  if (!event.target.closest(".search-field")) closeSearchResults();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") toggleUnitsMenu(false);
});

initializeMap();
setUnits(state.units);
loadWeather({ name: "Berlin", latitude: 52.52, longitude: 13.405, country: "Germany" });
