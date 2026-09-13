# Decide4me — Smart Meal Planner Upgrade

This version replaces the old random recommendation logic with a nutrition-aware,
explainable scoring system.

## What changed

- Separate check boxes for **Breakfast**, **Lunch**, and **Dinner**
- Builds a static database of **1,000+ USDA FNDDS foods**
- Uses **USDA FoodData Central** nutrient data
- No `Math.random()` recommendation
- Scores foods using:
  - meal-type fit
  - protein density
  - fiber density
  - sodium
  - saturated fat
  - recent food history
  - variety across the generated week
  - user-selected nutrition priority
- Shows nutrient values and an explanation for each recommendation
- Saves recent history with `localStorage`
- Includes vegetarian-style / vegan-style heuristic filtering
- Responsive design for phone and desktop

## Important health/data note

This is a general meal-planning student project, not medical nutrition advice.

FoodData Central values used by this app are generally displayed **per 100 g**.
A meal's real nutrition depends on recipe, ingredients, preparation method, and portion size.

The vegetarian/vegan tags in the build script are **heuristics based on food names and
available ingredient text**. Do not use them for allergy or religious-diet safety.

## Why the USDA API key is NOT in `app.js`

GitHub Pages is public. If you put an API key in browser JavaScript, everyone can see it.

USDA also instructs developers not to expose API keys publicly. Therefore the API is used
only once on your own computer to build `data/foods.json`. The deployed website only reads
that static JSON file.

## Setup

### 1. Install Node.js

Use Node.js 18 or later.

### 2. Get a free USDA FoodData Central API key

Go to:

https://fdc.nal.usda.gov/api-key-signup/

### 3. Build the food database

macOS / Linux:

```bash
USDA_API_KEY=YOUR_KEY npm run build:data
```

Windows PowerShell:

```powershell
$env:USDA_API_KEY="YOUR_KEY"
npm run build:data
```

The script will create:

```text
data/foods.json
```

It is configured to collect at least 1,000 foods and normally targets around 1,600 unique
FNDDS records.

### 4. Test locally

Because the app fetches a JSON file, do not open `index.html` directly with `file://`.

A simple option:

```bash
npx serve .
```

Then open the local URL shown in the terminal.

### 5. Deploy to GitHub Pages

Commit these files, including the generated `data/foods.json`:

```text
index.html
styles.css
app.js
data/foods.json
tools/build-usda-db.mjs
package.json
README.md
```

Push them to your `Decide4me-Meal-Planner` repository. GitHub Pages can continue serving the
site exactly as a static project.

## How the recommendation score works

The browser ranks all matching foods. It does **not** pick a random index.

The balanced score starts with a base score and then:

- rewards protein density
- rewards fiber density
- rewards lower sodium
- rewards lower saturated fat
- gives a small preference to moderate energy density
- applies a strong penalty to foods in recent history
- applies a penalty to foods already used elsewhere in the generated week

Choosing `Higher protein`, `Higher fiber`, or `Lower sodium` adds extra weight to that
specific nutrient dimension.

The score is a **relative app ranking**, not a medical or official USDA health score.

## Good next features

If you want to continue the project, the strongest additions would be:

- recipe/ingredient database with real serving sizes
- grocery-list generation
- saved favorite meals
- user accounts (Supabase/Firebase)
- budget filter
- cuisine filter
- Thai/local food tagging
- recipe photos
- meal-plan export to PDF
- optional backend for live FoodData Central lookups
