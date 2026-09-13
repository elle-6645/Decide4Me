const state = {
  foods: [],
  history: [],
  lastPlan: null
};

const mealEmoji = {
  breakfast: "🌅",
  lunch: "☀️",
  dinner: "🌙"
};

const mealLabel = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner"
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  loadHistory();
  renderHistory();

  try {
    const response = await fetch("./data/foods.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`foods.json returned ${response.status}`);

    const foods = await response.json();
    if (!Array.isArray(foods) || foods.length < 100) {
      throw new Error("Food database is missing or too small. Run the USDA data builder first.");
    }

    state.foods = foods;
    populateDatalist();
    document.getElementById("dataPill").textContent =
      `${foods.length.toLocaleString()} USDA foods loaded`;
  } catch (error) {
    document.getElementById("dataPill").textContent = "Food database not built";
    showError(
      "The smart food database is not ready yet. Run “npm install” and then “npm run build:data” locally, " +
      "commit data/foods.json, and redeploy GitHub Pages."
    );
    console.error(error);
  }
}

function bindEvents() {
  document.getElementById("addHistoryBtn").addEventListener("click", addHistory);
  document.getElementById("generateBtn").addEventListener("click", generatePlan);
  document.getElementById("editBtn").addEventListener("click", showPlanner);
  document.getElementById("regenerateBtn").addEventListener("click", generatePlan);

  document.getElementById("foodInput").addEventListener("keydown", event => {
    if (event.key === "Enter") addHistory();
  });
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem("decide4me_history_v2") || "[]");

    // Migrate the old version where history was just an array of strings.
    state.history = Array.isArray(saved)
      ? saved.map(item =>
          typeof item === "string"
            ? { name: item, mealType: "lunch" }
            : item
        )
      : [];
  } catch {
    state.history = [];
  }
}

function saveHistory() {
  localStorage.setItem("decide4me_history_v2", JSON.stringify(state.history.slice(-40)));
}

function populateDatalist() {
  const datalist = document.getElementById("foodOptions");
  datalist.innerHTML = "";

  // A datalist with a few thousand entries is fine in modern browsers.
  // Duplicate descriptions are removed during the build step.
  const fragment = document.createDocumentFragment();
  for (const food of state.foods) {
    const option = document.createElement("option");
    option.value = food.name;
    fragment.appendChild(option);
  }
  datalist.appendChild(fragment);
}

function addHistory() {
  const input = document.getElementById("foodInput");
  const name = input.value.trim();
  const mealType = document.getElementById("historyMealType").value;

  if (!name) return;

  state.history.push({ name, mealType, addedAt: Date.now() });
  state.history = state.history.slice(-40);
  saveHistory();
  renderHistory();
  input.value = "";
}

function removeHistory(index) {
  state.history.splice(index, 1);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const host = document.getElementById("historyTags");
  host.innerHTML = "";

  if (!state.history.length) {
    host.innerHTML = '<span class="empty">Nothing added yet. You can still create a plan.</span>';
    return;
  }

  state.history.forEach((item, index) => {
    const tag = document.createElement("span");
    tag.className = "tag";

    const name = document.createElement("span");
    name.textContent = item.name;

    const type = document.createElement("em");
    type.textContent = item.mealType || "meal";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removeHistory(index));

    tag.append(name, type, remove);
    host.appendChild(tag);
  });
}

function selectedMealTypes() {
  return [...document.querySelectorAll('#mealPicker input[type="checkbox"]:checked')]
    .map(input => input.value);
}

function currentOptions() {
  return {
    meals: selectedMealTypes(),
    priority: document.getElementById("priority").value,
    diet: document.getElementById("diet").value,
    avoid: document.getElementById("avoidInput").value
      .split(",")
      .map(value => normalize(value))
      .filter(Boolean)
  };
}

function generatePlan() {
  hideError();

  if (state.foods.length < 100) {
    showError("Food database is not loaded yet. Build data/foods.json first.");
    return;
  }

  const options = currentOptions();

  if (!options.meals.length) {
    showError("Choose at least one meal: breakfast, lunch or dinner.");
    return;
  }

  const usedIds = new Set();
  const today = {};

  for (const mealType of options.meals) {
    const result = bestFoodFor(mealType, options, usedIds);
    if (result) {
      today[mealType] = result;
      usedIds.add(result.food.id);
    }
  }

  const week = [];
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  for (const day of days) {
    const dayPlan = { day, meals: {} };

    for (const mealType of options.meals) {
      const result = bestFoodFor(mealType, options, usedIds);
      if (result) {
        dayPlan.meals[mealType] = result;
        usedIds.add(result.food.id);
      }
    }
    week.push(dayPlan);
  }

  state.lastPlan = { options, today, week };
  renderResults(state.lastPlan);
  showResults();
}

function bestFoodFor(mealType, options, usedIds) {
  const historyNames = state.history
    .filter(item => !item.mealType || item.mealType === mealType)
    .map(item => normalize(item.name));

  const candidates = [];

  for (const food of state.foods) {
    if (!food.mealTypes?.includes(mealType)) continue;
    if (!passesDiet(food, options.diet)) continue;
    if (!passesAvoidFilter(food, options.avoid)) continue;

    const score = scoreFood(food, options.priority, historyNames, usedIds);
    candidates.push({ food, score });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.food.name.localeCompare(b.food.name);
  });

  return candidates[0] || null;
}

function scoreFood(food, priority, historyNames, usedIds) {
  const n = food.nutrients || {};
  const protein = safe(n.protein);
  const fiber = safe(n.fiber);
  const sodium = safe(n.sodium);
  const satFat = safe(n.saturatedFat);
  const kcal = safe(n.calories);

  let score = 50;

  // General nutrition-fit components.
  score += Math.min(protein / 20, 1) * 12;
  score += Math.min(fiber / 5, 1) * 12;
  score += (1 - Math.min(sodium / 1000, 1)) * 10;
  score += (1 - Math.min(satFat / 10, 1)) * 8;

  // Moderate energy density bonus. This is not a calorie prescription.
  if (kcal >= 70 && kcal <= 350) score += 5;
  else if (kcal > 500) score -= 5;

  // User-selected nutrition priority.
  if (priority === "protein") score += Math.min(protein / 25, 1) * 18;
  if (priority === "fiber") score += Math.min(fiber / 7, 1) * 18;
  if (priority === "sodium") score += (1 - Math.min(sodium / 800, 1)) * 18;

  // Strongly reduce recent repeats.
  const foodName = normalize(food.name);
  for (const recent of historyNames) {
    if (!recent) continue;
    if (foodName === recent || foodName.includes(recent) || recent.includes(foodName)) {
      score -= 40;
      break;
    }
  }

  // Reduce repeats inside the generated weekly plan.
  if (usedIds.has(food.id)) score -= 35;

  // Small penalty for very incomplete nutrient records.
  const completeness = [n.calories, n.protein, n.fiber, n.sodium, n.saturatedFat]
    .filter(value => Number.isFinite(Number(value))).length;
  if (completeness < 4) score -= 8;

  return Math.round(score * 10) / 10;
}

function passesDiet(food, diet) {
  if (diet === "all") return true;
  return Array.isArray(food.tags) && food.tags.includes(diet);
}

function passesAvoidFilter(food, avoidTerms) {
  if (!avoidTerms.length) return true;
  const haystack = normalize(`${food.name} ${food.ingredients || ""}`);
  return !avoidTerms.some(term => haystack.includes(term));
}

function renderResults(plan) {
  const cards = document.getElementById("todayCards");
  cards.innerHTML = "";

  for (const mealType of plan.options.meals) {
    const result = plan.today[mealType];
    if (!result) continue;
    cards.appendChild(buildRecommendationCard(mealType, result));
  }

  document.getElementById("resultSummary").textContent =
    `${plan.options.meals.map(type => mealLabel[type]).join(", ")} • ` +
    `${labelPriority(plan.options.priority)} • ${state.foods.length.toLocaleString()} USDA foods searched`;

  renderTable(plan);
}

function buildRecommendationCard(mealType, result) {
  const { food, score } = result;
  const n = food.nutrients || {};
  const card = document.createElement("article");
  card.className = "rec-card";

  card.innerHTML = `
    <div class="card-top">
      <span class="meal-badge">${mealEmoji[mealType]} ${escapeHtml(mealLabel[mealType])}</span>
      <span class="score" title="Relative nutrition-fit score">${clamp(Math.round(score), 0, 99)}</span>
    </div>
    <h3>${escapeHtml(food.name)}</h3>
    <div class="source-id">USDA FDC ID ${escapeHtml(String(food.id))} • values per 100 g</div>
    <div class="nutrient-grid">
      ${nutrientBox(formatNumber(n.calories, 0, " kcal"), "Energy")}
      ${nutrientBox(formatNumber(n.protein, 1, " g"), "Protein")}
      ${nutrientBox(formatNumber(n.fiber, 1, " g"), "Fiber")}
      ${nutrientBox(formatNumber(n.sodium, 0, " mg"), "Sodium")}
    </div>
    <p class="why">${escapeHtml(explainFood(food))}</p>
  `;
  return card;
}

function renderTable(plan) {
  const table = document.getElementById("scheduleTable");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = `
    <tr>
      <th>Day</th>
      ${plan.options.meals.map(type => `<th>${escapeHtml(mealLabel[type])}</th>`).join("")}
    </tr>
  `;

  tbody.innerHTML = plan.week.map(dayPlan => `
    <tr>
      <td><strong>${escapeHtml(dayPlan.day)}</strong></td>
      ${plan.options.meals.map(type => {
        const result = dayPlan.meals[type];
        if (!result) return "<td>—</td>";
        const n = result.food.nutrients || {};
        return `
          <td>
            <strong>${escapeHtml(result.food.name)}</strong>
            <small>${formatNumber(n.protein, 1, "g protein")} • ${formatNumber(n.fiber, 1, "g fiber")} • ${formatNumber(n.sodium, 0, "mg sodium")}</small>
          </td>
        `;
      }).join("")}
    </tr>
  `).join("");
}

function explainFood(food) {
  const n = food.nutrients || {};
  const positives = [];

  if (safe(n.protein) >= 15) positives.push("higher protein density");
  if (safe(n.fiber) >= 4) positives.push("useful fiber density");
  if (safe(n.sodium) > 0 && safe(n.sodium) <= 400) positives.push("lower sodium in this database");
  if (safe(n.saturatedFat) <= 3) positives.push("lower saturated fat in this database");

  if (!positives.length) {
    return "Selected because it had the strongest overall score after meal type, nutrition profile and variety were considered.";
  }

  return `Ranked well for ${positives.slice(0, 3).join(", ")}. The score is relative to other matching foods, not a medical rating.`;
}

function nutrientBox(value, label) {
  return `<div class="nutrient"><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></div>`;
}

function labelPriority(value) {
  return {
    balanced: "Balanced ranking",
    protein: "Higher-protein ranking",
    fiber: "Higher-fiber ranking",
    sodium: "Lower-sodium ranking"
  }[value] || "Balanced ranking";
}

function showResults() {
  document.getElementById("plannerView").classList.add("hidden");
  document.querySelector(".hero").classList.add("hidden");
  document.getElementById("resultView").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showPlanner() {
  document.getElementById("resultView").classList.add("hidden");
  document.getElementById("plannerView").classList.remove("hidden");
  document.querySelector(".hero").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showError(message) {
  const box = document.getElementById("errorBox");
  box.textContent = message;
  box.classList.remove("hidden");
}

function hideError() {
  document.getElementById("errorBox").classList.add("hidden");
}

function safe(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value, decimals, suffix) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}${suffix}`;
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
// Register PWA service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then(registration => {
        console.log(
          "Decide4me service worker registered:",
          registration.scope
        );
      })
      .catch(error => {
        console.error(
          "Service worker registration failed:",
          error
        );
      });
  });
}

// PWA installation
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;

  const button = document.getElementById("installBtn");
  if (button) button.classList.remove("hidden");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  const button = document.getElementById("installBtn");
  if (button) button.classList.add("hidden");
});

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("installBtn");
  if (!button) return;

  button.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    button.classList.add("hidden");
  });
});
