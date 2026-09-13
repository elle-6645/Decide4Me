/**
 * Build a static, nutrition-aware food database for GitHub Pages from
 * USDA FoodData Central search results.
 *
 * Why build-time instead of browser-time?
 * --------------------------------------
 * FoodData Central requires an API key, and USDA says API keys must not be
 * made public. A GitHub Pages JavaScript file is public, so this script runs
 * only on your own computer. It writes data/foods.json; only that JSON file
 * is committed/deployed.
 *
 * Requirements:
 *   Node.js 18+
 *   USDA_API_KEY environment variable
 *
 * Usage:
 *   npm run build:data
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outFile = path.join(projectRoot, "data", "foods.json");

const API_KEY = process.env.USDA_API_KEY;
if (!API_KEY) {
  console.error(`
Missing USDA_API_KEY.

Get a free FoodData Central API key from:
https://fdc.nal.usda.gov/api-key-signup/

macOS/Linux:
  USDA_API_KEY=YOUR_KEY npm run build:data

Windows PowerShell:
  $env:USDA_API_KEY="YOUR_KEY"; npm run build:data
`);
  process.exit(1);
}

const TARGET_COUNT = 1600;
const PAGE_SIZE = 100;

// Query groups are deliberately broad. An item can collect multiple mealTypes
// if it appears in more than one search group.
const queryGroups = {
  breakfast: [
    "oatmeal", "breakfast cereal", "egg breakfast", "omelet", "pancake",
    "waffle", "French toast", "bagel", "breakfast sandwich", "yogurt",
    "rice porridge", "congee", "fruit breakfast", "toast", "breakfast burrito"
  ],
  lunch: [
    "sandwich", "salad", "soup", "rice bowl", "noodle dish",
    "wrap", "chicken dish", "fish dish", "beans", "pasta",
    "curry", "stir fry", "taco", "rice and beans", "mixed dish"
  ],
  dinner: [
    "chicken", "beef", "pork", "fish", "seafood",
    "pasta dish", "rice dish", "curry", "stir fry", "vegetable dish",
    "tofu", "lentil", "stew", "roast", "grilled"
  ]
};

const rejectPattern =
  /\b(alcohol|beer|wine|liquor|cocktail|soft drink|soda|energy drink|sports drink|coffee|tea|water beverage|infant formula|baby food|candy|chewing gum)\b/i;

const obviousAnimal =
  /\b(beef|pork|ham|bacon|chicken|turkey|duck|lamb|mutton|veal|fish|salmon|tuna|shrimp|prawn|crab|lobster|oyster|clam|mussel|anchov|sardine|meat|sausage|pepperoni)\b/i;

const obviousNonVegan =
  /\b(milk|cheese|yogurt|yoghurt|cream|butter|egg|honey|whey|casein)\b/i;

const records = new Map();

for (const [mealType, queries] of Object.entries(queryGroups)) {
  for (const query of queries) {
    process.stdout.write(`Searching ${mealType.padEnd(9)} | ${query} ... `);

    try {
      const results = await searchFoodDataCentral(query);
      let accepted = 0;

      for (const item of results) {
        const converted = convertFood(item, mealType);
        if (!converted) continue;

        const existing = records.get(converted.id);
        if (existing) {
          if (!existing.mealTypes.includes(mealType)) existing.mealTypes.push(mealType);
        } else {
          records.set(converted.id, converted);
          accepted++;
        }
      }

      console.log(`${accepted} new`);
    } catch (error) {
      console.log(`failed: ${error.message}`);
    }

    // Polite pacing. Also makes transient rate-limit problems less likely.
    await sleep(120);
  }
}

// If there are too many, keep entries with more complete nutrient data first.
const finalFoods = [...records.values()]
  .sort((a, b) => nutrientCompleteness(b) - nutrientCompleteness(a) || a.name.localeCompare(b.name))
  .slice(0, Math.max(TARGET_COUNT, 1000))
  .sort((a, b) => a.name.localeCompare(b.name));

if (finalFoods.length < 1000) {
  console.error(
    `\nOnly ${finalFoods.length} unique foods were collected. ` +
    `Add more search terms in tools/build-usda-db.mjs and run again.`
  );
  process.exit(1);
}

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify(finalFoods, null, 2), "utf8");

console.log(`\nDone. Wrote ${finalFoods.length.toLocaleString()} foods to ${outFile}`);
console.log("You can now commit data/foods.json and deploy with GitHub Pages.");

async function searchFoodDataCentral(query) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(API_KEY)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      dataType: ["Survey (FNDDS)"],
      pageSize: PAGE_SIZE,
      pageNumber: 1,
      sortBy: "dataType.keyword",
      sortOrder: "asc"
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 140)}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.foods) ? payload.foods : [];
}

function convertFood(item, mealType) {
  const name = clean(item.description);
  if (!name || rejectPattern.test(name)) return null;

  const nutrients = {
    calories: nutrientValue(item, ["Energy"]),
    protein: nutrientValue(item, ["Protein"]),
    fiber: nutrientValue(item, ["Fiber, total dietary", "Fiber"]),
    sodium: nutrientValue(item, ["Sodium, Na", "Sodium"]),
    saturatedFat: nutrientValue(item, ["Fatty acids, total saturated", "Saturated fat"]),
    carbohydrates: nutrientValue(item, ["Carbohydrate, by difference", "Carbohydrate"]),
    totalFat: nutrientValue(item, ["Total lipid (fat)", "Total fat"])
  };

  if (!Number.isFinite(nutrients.calories)) return null;

  const combined = `${name} ${item.ingredients || ""}`;
  const tags = [];

  if (!obviousAnimal.test(combined)) {
    tags.push("vegetarian");
    if (!obviousNonVegan.test(combined)) tags.push("vegan");
  }

  return {
    id: item.fdcId,
    name,
    mealTypes: [mealType],
    tags,
    ingredients: clean(item.ingredients || ""),
    category: clean(item.foodCategory || item.foodCategoryDescription || ""),
    dataType: item.dataType || "Survey (FNDDS)",
    nutrients,
    source: {
      provider: "USDA FoodData Central",
      fdcId: item.fdcId
    }
  };
}

function nutrientValue(item, names) {
  const list = Array.isArray(item.foodNutrients) ? item.foodNutrients : [];

  for (const wanted of names) {
    const found = list.find(n => {
      const name = n.nutrientName || n.nutrient?.name || "";
      return name.toLowerCase() === wanted.toLowerCase();
    });

    if (found) {
      const value = found.value ?? found.amount;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }

  return null;
}

function nutrientCompleteness(food) {
  return Object.values(food.nutrients).filter(value => Number.isFinite(value)).length;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
