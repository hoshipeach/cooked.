// Shared import contract. Deliberately dependency-free for the browser and server.
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 800) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const time = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const positive = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
export function validatePlan(p) {
  const errors = [], warnings = [];
  const need = (condition, message) => { if (!condition) errors.push(message); };
  if (!obj(p)) return { errors: ['The plan must be a JSON object.'], warnings };
  need(p.schemaVersion === '1.1.0', 'Use schemaVersion 1.1.0.');
  need(text(p.planId, 100), 'Add a planId (up to 100 characters).');
  need(Number.isInteger(p.revision) && p.revision > 0, 'Revision must be a positive integer.');
  try { new Intl.DateTimeFormat('en', { timeZone: p.timezone }); need(text(p.timezone, 100), 'Add a timezone.'); } catch { errors.push('Timezone must be an IANA timezone such as Asia/Dubai.'); }
  need(obj(p.menu) && text(p.menu.title, 120) && typeof p.menu.description === 'string' && p.menu.description.length <= 800, 'Add a menu title and description.');
  const date = p.service?.date;
  need(obj(p.service) && text(p.service.label, 120) && time(p.service.targetTime), 'Add a service label and targetTime in HH:MM format.');
  need(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date, 'Add a valid service date in YYYY-MM-DD format.');
  need(Array.isArray(p.dishes) && p.dishes.length > 0 && p.dishes.length <= 30, 'Include 1–30 dishes.');
  need(Array.isArray(p.ingredients) && p.ingredients.length <= 150, 'Ingredients must be an array of up to 150 items.');
  need(Array.isArray(p.timeline) && p.timeline.length > 0 && p.timeline.length <= 60, 'Include 1–60 timeline stages.');
  if (errors.length) return { errors, warnings };
  const ids = (items, label) => {
    const seen = new Set();
    for (const x of items) {
      if (!obj(x) || typeof x.id !== 'string' || !/^[a-z0-9-]{1,100}$/.test(x.id) || seen.has(x.id)) errors.push(`${label} need unique lower-case IDs (letters, numbers and hyphens).`);
      else seen.add(x.id);
    }
    return seen;
  };
  const dishIds = ids(p.dishes, 'Dishes'), ingredientIds = ids(p.ingredients, 'Ingredients'), stageIds = ids(p.timeline, 'Stages');
  if (errors.length) return { errors, warnings };
  for (const d of p.dishes) {
    need(text(d.name, 120) && Array.isArray(d.stageIds) && d.stageIds.every(id => stageIds.has(id)) && new Set(d.stageIds).size === d.stageIds.length, `Check the name and stageIds for dish ${d.id}.`);
  }
  for (const i of p.ingredients) {
    need(text(i.name, 120) && obj(i.recipeTotal) && positive(i.recipeTotal.quantity) && text(i.recipeTotal.unit, 30), `Check the name, total quantity and unit for ${i.id}.`);
    need(['verified','demonstration','needs-review'].includes(i.verification), `Add a verification status for ${i.id}.`);
    if (i.verification !== 'verified') warnings.push(`${i.name || i.id}: ${i.verification === 'demonstration' ? 'demonstration quantity' : 'quantity needs review'}.`);
  }
  let previous = '';
  for (const s of p.timeline) {
    need(dishIds.has(s.dishId), `Stage ${s.id} refers to an unknown dish.`);
    need(time(s.scheduledTime), `Stage ${s.id} needs a time in HH:MM format.`);
    need(text(s.instruction, 800) && text(s.shortLabel, 100), `Stage ${s.id} needs an instruction and shortLabel.`);
    need(s.timer === null || (obj(s.timer) && text(s.timer.label, 100) && Number.isInteger(s.timer.durationSeconds) && s.timer.durationSeconds > 0), `Check the timer for ${s.id}.`);
    need(Array.isArray(s.ingredientAllocations) && s.ingredientAllocations.length <= 150, `Stage ${s.id} needs an ingredientAllocations array.`);
    if (previous && s.scheduledTime < previous) errors.push('Put stages in time order. This version supports cooking within one calendar day.');
    previous = s.scheduledTime;
    if (time(s.scheduledTime) && s.scheduledTime > p.service.targetTime) errors.push(`Stage ${s.id} is after the ready time.`);
    for (const a of Array.isArray(s.ingredientAllocations) ? s.ingredientAllocations : []) {
      need(obj(a) && ingredientIds.has(a.ingredientId) && (a.quantity === null || positive(a.quantity)) && text(a.unit,30) && (a.preparation === null || typeof a.preparation === 'string' && a.preparation.length <= 200), `Check an ingredient allocation in ${s.id}.`);
    }
    const listed = p.dishes.find(d => d.id === s.dishId);
    if (listed && Array.isArray(listed.stageIds)) need(listed.stageIds.includes(s.id), `Dish ${listed.id} must list stage ${s.id}.`);
  }
  for (const d of p.dishes) if (Array.isArray(d.stageIds)) for (const id of d.stageIds) need(p.timeline.find(s => s.id === id)?.dishId === d.id, `Dish ${d.id} lists a stage belonging to another dish.`);
  if (!errors.length) for (const i of p.ingredients) {
    const allocations = p.timeline.flatMap(s => s.ingredientAllocations).filter(a => a.ingredientId === i.id);
    if (!allocations.length) warnings.push(`${i.name}: no stage allocation.`);
    else if (allocations.some(a => a.unit !== i.recipeTotal.unit || a.quantity === null)) warnings.push(`${i.name}: stage quantities cannot be reconciled with the total.`);
    else if (Math.abs(allocations.reduce((n,a) => n+a.quantity,0) - i.recipeTotal.quantity) > 0.00001) errors.push(`${i.name}: stage amounts do not add up to the recipe total.`);
  }
  if (!errors.length && new TextEncoder().encode(JSON.stringify(toEchoPlan(p))).length > 20000) errors.push('The plan is too long for this Echo prototype. Shorten the stage instructions.');
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
export function parsePlan(source) {
  const cleaned = source.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/, '$1');
  if (new TextEncoder().encode(cleaned).length > 131072) throw new Error('The plan must be smaller than 128 KB.');
  let plan;
  try { plan = JSON.parse(cleaned); } catch { throw new Error('This is not valid JSON. Paste only the cooking plan, or import a .json file.'); }
  const result = validatePlan(plan);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  return { plan, warnings: result.warnings };
}
export function toEchoPlan(p) {
  return {
    title: p.menu.title, readyLabel: p.service.targetTime,
    date: p.service.date, timezone: p.timezone,
    steps: p.timeline.map((s,index) => {
      const ingredients = s.ingredientAllocations.map(a => {
        const ingredient = p.ingredients.find(i => i.id === a.ingredientId);
        return `${ingredient.name}: ${a.quantity === null ? 'as needed' : `${a.quantity} ${a.unit}`}${a.preparation ? ` (${a.preparation})` : ''}`;
      });
      return { index, timeLabel: s.scheduledTime, text: s.instruction, shortText: s.shortLabel, ingredients, timer: s.timer };
    })
  };
}
