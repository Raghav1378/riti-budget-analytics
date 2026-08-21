import React, { useState, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area,
} from "recharts";
import {
  LayoutGrid, Building2, Landmark, Sparkles, UploadCloud, FileSpreadsheet,
  MessageCircle, X, TrendingUp, TrendingDown, Minus, Map, ChevronRight,
  FileDown, Send, AlertCircle, RefreshCcw, Calculator,
} from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

async function streamAskGemini(question, dataSummary, computedAnswer, scopeDeptId, scopeLabel, onToken) {
  const apiBase = import.meta.env.VITE_API_URL || "";
  const res = await fetch(`${apiBase}/api/ask/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, dataSummary, computedAnswer, scopeDeptId, scopeLabel }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini request failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("Streaming is not supported by this response.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sources = [];
  let completeText = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const data = JSON.parse(dataLine.slice(6));
      if (data.type === "error") throw new Error(data.error || "Streaming request failed.");
      if (data.type === "token" && data.text) {
        completeText += data.text;
        onToken(data.text, completeText);
      }
      if (data.type === "done") sources = data.sources || [];
    }
    if (done) break;
  }
  if (!completeText) throw new Error("Gemini returned no text");
  return { text: completeText.trim(), sources };
}

function buildDataSummary(ds, scopeDeptId) {
  const latestYear = ds.years[ds.years.length - 1];
  const depts = scopeDeptId ? ds.departments.filter((d) => d.id === scopeDeptId) : ds.departments;
  const lines = [];
  depts.forEach((d) => {
    const total = ds.sanctioned.filter((r) => r.dept === d.id && r.year === latestYear).reduce((a, b) => a + b.sanctioned, 0);
    lines.push(`${d.name} total (${latestYear}): Rs ${Math.round(total)} Cr`);
    (ds.schemesByDept[d.id] || []).forEach((s) => {
      const schemeRows = ds.sanctioned.filter((r) => r.scheme === s.id);
      const hist = schemeRows.map((r) => `${r.year}: Rs ${r.sanctioned} Cr`).join(", ");
      const notes = schemeRows.map((r) => r.notes).filter(Boolean).join(" | ");
      const unitCost = ds.unitCosts[s.id];
      const unitFacts = unitCost ? `; unit rate: Rs ${(unitCost.material + unitCost.labor + unitCost.material * unitCost.contingencyPct / 100).toFixed(2)} lakh per ${unitCost.unitLabel} (material Rs ${unitCost.material}L, labour Rs ${unitCost.labor}L, contingency ${unitCost.contingencyPct}%)` : "";
      lines.push(`  - ${s.name} (${s.category}): ${hist || "no data"}${unitFacts}${notes ? `; uploaded notes: ${notes}` : ""}`);
    });
  });
  return lines.join("\n");
}

function summarizeComputedAnswer(answer) {
  if (answer.kind === "estimate") return `${answer.text}`;
  if (answer.kind === "list") return `${answer.text} ${(answer.rows || []).map((r) => `${r.scheme}: ${r.avgUtil.toFixed(0)}% utilization`).join("; ")}`;
  if (answer.kind === "chart") return answer.text;
  return answer.text;
}

const YEARS_SANCTIONED = ["FY19-20", "FY20-21", "FY21-22", "FY22-23", "FY23-24", "FY24-25"];
const YEARS_ACTUAL = ["FY22-23", "FY23-24", "FY24-25"];
const DISTRICTS = ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Bikaner", "Ajmer"];

const DEMO_DEPARTMENTS_META = [
  { id: "education", name: "Education", sector: "Education", color: "#2E74B5" },
  { id: "health", name: "Health & Family Welfare", sector: "Health", color: "#3E8E7E" },
  { id: "pwd", name: "Public Works Department", sector: "Roads & Infrastructure", color: "#B5762E" },
  { id: "water", name: "Water Resources", sector: "Water & Irrigation", color: "#2E5FB5" },
  { id: "rural_dev", name: "Rural Development & Panchayati Raj", sector: "Rural Development", color: "#7A4EA8" },
  { id: "agriculture", name: "Agriculture", sector: "Agriculture", color: "#A83E5A" },
  { id: "tourism", name: "Tourism", sector: "Tourism", color: "#C77D2E" },
];

const DEMO_SCHEMES_META = {
  education: [
    { id: "school_construction", name: "School Construction", category: "Capital", unitLabel: "classroom", base: 62 },
    { id: "teacher_salaries", name: "Teacher Salaries", category: "Salary", base: 410 },
    { id: "mid_day_meal", name: "Mid-Day Meal Scheme", category: "Transfer", base: 95 },
    { id: "school_maintenance", name: "School Maintenance", category: "O&M", base: 28 },
  ],
  health: [
    { id: "phc_construction", name: "Primary Health Centre Construction", category: "Capital", unitLabel: "PHC", base: 34 },
    { id: "medical_salaries", name: "Medical Staff Salaries", category: "Salary", base: 285 },
    { id: "medicine_procurement", name: "Medicine Procurement", category: "Transfer", base: 71 },
    { id: "equipment_maintenance", name: "Hospital Equipment Maintenance", category: "O&M", base: 19 },
  ],
  pwd: [
    { id: "road_widening", name: "Road Widening", category: "Capital", unitLabel: "km", base: 88 },
    { id: "bridge_construction", name: "Bridge Construction", category: "Capital", unitLabel: "bridge", base: 46 },
    { id: "road_maintenance", name: "Road Maintenance", category: "O&M", base: 53 },
  ],
  water: [
    { id: "canal_lining", name: "Canal Lining", category: "Capital", unitLabel: "km", base: 41 },
    { id: "tubewell_installation", name: "Tubewell Installation", category: "Capital", unitLabel: "tubewell", base: 22 },
    { id: "irrigation_salaries", name: "Irrigation Department Salaries", category: "Salary", base: 64 },
  ],
  rural_dev: [
    { id: "gp_building", name: "Gram Panchayat Building", category: "Capital", unitLabel: "building", base: 30 },
    { id: "mgnrega_wages", name: "MGNREGA Wages", category: "Transfer", base: 155 },
    { id: "panchayat_salaries", name: "Panchayat Staff Salaries", category: "Salary", base: 58 },
  ],
  agriculture: [
    { id: "farm_subsidy", name: "Farm Subsidy Disbursement", category: "Transfer", base: 120 },
    { id: "agri_salaries", name: "Agriculture Extension Salaries", category: "Salary", base: 42 },
    { id: "cold_storage", name: "Cold Storage Construction", category: "Capital", unitLabel: "unit", base: 18 },
  ],
  tourism: [
    { id: "heritage_restoration", name: "Heritage Site Restoration", category: "Capital", unitLabel: "site", base: 24 },
    { id: "tourism_salaries", name: "Tourism Department Salaries", category: "Salary", base: 16 },
    { id: "tourism_promotion", name: "Tourism Promotion & Marketing", category: "Transfer", base: 21 },
    { id: "circuit_maintenance", name: "Tourist Circuit Maintenance", category: "O&M", base: 12 },
  ],
};

const DEMO_UNIT_COSTS = {
  school_construction: { material: 8.5, labor: 2.1, contingencyPct: 10, unitLabel: "classroom" },
  phc_construction: { material: 62, labor: 18, contingencyPct: 12, unitLabel: "PHC" },
  road_widening: { material: 74, labor: 22, contingencyPct: 8, unitLabel: "km" },
  bridge_construction: { material: 310, labor: 85, contingencyPct: 15, unitLabel: "bridge" },
  canal_lining: { material: 48, labor: 14, contingencyPct: 9, unitLabel: "km" },
  tubewell_installation: { material: 9.2, labor: 2.4, contingencyPct: 10, unitLabel: "tubewell" },
  gp_building: { material: 21, labor: 6.5, contingencyPct: 10, unitLabel: "building" },
  cold_storage: { material: 140, labor: 35, contingencyPct: 12, unitLabel: "unit" },
  heritage_restoration: { material: 165, labor: 40, contingencyPct: 14, unitLabel: "site" },
};

function seeded(seed) { let x = Math.sin(seed) * 10000; return x - Math.floor(x); }

function buildDemoWarehouse() {
  const sanctioned = [];
  DEMO_DEPARTMENTS_META.forEach((dept, di) => {
    (DEMO_SCHEMES_META[dept.id] || []).forEach((scheme, si) => {
      YEARS_SANCTIONED.forEach((year, yi) => {
        const growth = 1 + 0.055 + (seeded(di * 97 + si * 13 + yi) - 0.5) * 0.06;
        const value = scheme.base * Math.pow(growth, yi);
        sanctioned.push({ dept: dept.id, deptName: dept.name, scheme: scheme.id, schemeName: scheme.name, category: scheme.category, year, sanctioned: Math.round(value * 10) / 10 });
      });
    });
  });
  const actual = [];
  sanctioned.filter((r) => YEARS_ACTUAL.includes(r.year)).forEach((r) => {
    const util = 0.88 + seeded(r.dept.length * 31 + r.scheme.length * 7 + r.year.length) * 0.13;
    const utilClamped = Math.min(util, 1.03);
    actual.push({ ...r, actual: Math.round(r.sanctioned * utilClamped * 10) / 10, utilization: Math.round(utilClamped * 1000) / 10 });
  });
  return { sanctioned, actual };
}
const DEMO_WAREHOUSE = buildDemoWarehouse();

const PALETTE = ["#2E74B5", "#3E8E7E", "#B5762E", "#2E5FB5", "#7A4EA8", "#A83E5A", "#C77D2E", "#4E9BA8", "#8E5E3E", "#5A7A2E"];

function buildDemoDataSource() {
  return {
    departments: DEMO_DEPARTMENTS_META,
    schemesByDept: DEMO_SCHEMES_META,
    years: YEARS_SANCTIONED,
    yearsActual: YEARS_ACTUAL,
    sanctioned: DEMO_WAREHOUSE.sanctioned,
    actual: DEMO_WAREHOUSE.actual,
    unitCosts: DEMO_UNIT_COSTS,
    isUploaded: false,
    districts: DISTRICTS,
    label: "Demo dataset (Rajasthan, illustrative)",
  };
}

const COLUMN_HINTS = {
  department: ["department", "dept", "ministry", "vibhaag", "vibhag"],
  scheme: ["scheme", "yojana", "line item", "head", "sub head", "activity", "project"],
  category: ["category", "type", "head of account", "nature"],
  year: ["year", "fiscal", "fy"],
  sanctioned: ["sanctioned", "allocated", "budget", "outlay budget", "bud get", "provision"],
  actual: ["actual", "expenditure", "spent", "outlay", "utilised", "utilized"],
  unit: ["unit", "quantity", "qty", "count", "no of", "number of", "nos"],
  unitCost: ["unit cost", "rate", "cost per", "per unit"],
  district: ["district", "block", "zila"],
};

function guessColumnMapping(headers) {
  const mapping = {};
  const used = new Set();
  Object.entries(COLUMN_HINTS).forEach(([field, hints]) => {
    let best = null;
    headers.forEach((h) => {
      if (used.has(h)) return;
      const hLower = h.toLowerCase().trim();
      if (hints.some((hint) => hLower.includes(hint))) {
        if (!best) best = h;
      }
    });
    if (best) { mapping[field] = best; used.add(best); }
  });
  return mapping;
}

function parseUploadedRows(rows, mapping) {
  const departments = new Map();
  const schemesByDept = {};
  const sanctioned = [];
  const actualRows = [];
  let colorIdx = 0;

  rows.forEach((row) => {
    const deptNameRaw = mapping.department ? String(row[mapping.department] || "").trim() : "General";
    const deptName = deptNameRaw || "Unspecified Department";
    const deptId = deptName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "dept";
    if (!departments.has(deptId)) {
      departments.set(deptId, { id: deptId, name: deptName, sector: deptName, color: PALETTE[colorIdx % PALETTE.length] });
      colorIdx++;
    }

    const schemeNameRaw = mapping.scheme ? String(row[mapping.scheme] || "").trim() : deptName;
    const schemeName = schemeNameRaw || "Unspecified Scheme";
    const schemeSlug = schemeName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "scheme";
    const schemeId = `${deptId}__${schemeSlug}`;

    const category = mapping.category ? (String(row[mapping.category] || "").trim() || "Capital") : "Capital";
    const yearRaw = mapping.year ? String(row[mapping.year] || "").trim() : null;
    const year = yearRaw || "FY24-25";

    const sanctionedVal = mapping.sanctioned ? parseFloat(String(row[mapping.sanctioned]).replace(/[^0-9.-]/g, "")) : NaN;
    const actualVal = mapping.actual ? parseFloat(String(row[mapping.actual]).replace(/[^0-9.-]/g, "")) : NaN;
    const unitCount = mapping.unit ? parseFloat(String(row[mapping.unit]).replace(/[^0-9.-]/g, "")) : NaN;
    const unitCostVal = mapping.unitCost ? parseFloat(String(row[mapping.unitCost]).replace(/[^0-9.-]/g, "")) : NaN;

    if (!schemesByDept[deptId]) schemesByDept[deptId] = [];
    let schemeEntry = schemesByDept[deptId].find((s) => s.id === schemeId);
    if (!schemeEntry) {
      schemeEntry = { id: schemeId, name: schemeName, category, base: 0, unitLabel: mapping.unit ? "unit" : undefined };
      if (!isNaN(unitCostVal) && unitCostVal > 0) {
        schemeEntry.unitCost = { material: unitCostVal * 0.7, labor: unitCostVal * 0.3, contingencyPct: 0, unitLabel: "unit" };
      }
      schemesByDept[deptId].push(schemeEntry);
    }

    if (!isNaN(sanctionedVal)) {
      sanctioned.push({ dept: deptId, deptName, scheme: schemeId, schemeName, category, year, sanctioned: sanctionedVal, unitCount: isNaN(unitCount) ? null : unitCount, notes: row.notes || "" });
    }
    if (!isNaN(actualVal)) {
      actualRows.push({ dept: deptId, deptName, scheme: schemeId, schemeName, category, year, actual: actualVal });
    }
  });

  const actual = actualRows.map((a) => {
    const match = sanctioned.find((s) => s.scheme === a.scheme && s.year === a.year);
    const util = match && match.sanctioned > 0 ? Math.round((a.actual / match.sanctioned) * 1000) / 10 : null;
    return { ...a, sanctioned: match ? match.sanctioned : null, utilization: util };
  });

  const years = Array.from(new Set(sanctioned.map((r) => r.year))).sort();
  const yearsActual = Array.from(new Set(actual.map((r) => r.year))).sort();

  const unitCosts = {};
  Object.values(schemesByDept).flat().forEach((s) => { if (s.unitCost) unitCosts[s.id] = s.unitCost; });

  Object.values(schemesByDept).flat().forEach((s) => {
    const vals = sanctioned.filter((r) => r.scheme === s.id).map((r) => r.sanctioned);
    s.base = vals.length ? vals[0] : 1;
  });

  return {
    departments: Array.from(departments.values()),
    schemesByDept,
    years: years.length ? years : ["Current"],
    yearsActual,
    sanctioned,
    actual,
    unitCosts,
    isUploaded: true,
    districts: DISTRICTS,
    label: "Uploaded dataset",
  };
}

function schemeInfo(ds, schemeId) {
  for (const d of ds.departments) {
    const s = (ds.schemesByDept[d.id] || []).find((s) => s.id === schemeId);
    if (s) return { ...s, dept: d };
  }
  return null;
}

function schemeHistory(ds, schemeId) {
  const rows = ds.sanctioned.filter((r) => r.scheme === schemeId);
  return rows.map((r) => {
    const act = ds.actual.find((a) => a.scheme === schemeId && a.year === r.year);
    return { ...r, actual: act ? act.actual : null, utilization: act ? act.utilization : null };
  });
}

function cagr(values) {
  const clean = values.filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (clean.length < 2) return 0.055;
  const first = clean[0], last = clean[clean.length - 1];
  const n = clean.length - 1;
  if (first <= 0 || n <= 0) return 0.055;
  return Math.pow(last / first, 1 / n) - 1;
}

function coeffOfVariation(values) {
  const clean = values.filter((v) => v !== null && !isNaN(v));
  if (!clean.length) return 0.15;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length;
  return mean === 0 ? 1 : Math.sqrt(variance) / mean;
}

function estimateUnitCost(ds, schemeId, count) {
  const rates = ds.unitCosts[schemeId];
  if (!rates || !count) return null;
  const perUnit = rates.material + rates.labor + rates.material * (rates.contingencyPct / 100);
  const total = perUnit * count;
  return {
    perUnitLakh: Math.round(perUnit * 100) / 100,
    totalCr: Math.round((total / 100) * 100) / 100,
    breakdown: { material: Math.round(rates.material * 100) / 100, labor: Math.round(rates.labor * 100) / 100, contingency: Math.round(rates.material * (rates.contingencyPct / 100) * 100) / 100 },
    unitLabel: rates.unitLabel,
  };
}

function validateAgainstHistory(ds, estimateCr, schemeId) {
  const hist = schemeHistory(ds, schemeId).map((h) => h.sanctioned).filter((v) => v !== null);
  if (!hist.length) return { avgHistorical: estimateCr, deviation: 0, confidence: 0.6 };
  const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
  const deviation = avg > 0 ? Math.abs(estimateCr - avg) / avg : 0;
  const cv = coeffOfVariation(hist);
  const confidence = Math.max(0.35, Math.min(0.98, 1 - cv * 1.4 - deviation * 0.5));
  return { avgHistorical: Math.round(avg * 10) / 10, deviation, confidence: Math.round(confidence * 100) / 100 };
}

function recommendAspiration(ds, estimateCr, schemeId, confidence) {
  const hist = schemeHistory(ds, schemeId);
  const growth = cagr(hist.map((h) => h.sanctioned));
  const utilRows = hist.filter((h) => h.utilization !== null);
  const avgUtil = utilRows.length ? utilRows.reduce((a, b) => a + b.utilization, 0) / utilRows.length / 100 : 0.94;
  const riskBuffer = 1 + (1 - confidence) * 0.15 + 0.05;
  const realistic = (estimateCr / Math.max(avgUtil, 0.5)) * (1 + growth) * riskBuffer;
  return {
    growthPct: Math.round(growth * 1000) / 10,
    utilizationPct: Math.round(avgUtil * 1000) / 10,
    conservative: Math.round(realistic * 0.93 * 10) / 10,
    realistic: Math.round(realistic * 10) / 10,
    ambitious: Math.round(realistic * 1.09 * 10) / 10,
  };
}

function findSchemeByFuzzyMatch(ds, text) {
  const t = text.toLowerCase();
  let best = null, bestScore = 0;
  Object.values(ds.schemesByDept).flat().forEach((s) => {
    const words = s.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const unitMatch = s.unitLabel && (t.includes(s.unitLabel.toLowerCase()) || t.includes(`${s.unitLabel.toLowerCase()}s`));
    const aliases = s.id === "school_construction" && /classroom|classrooms|school room/.test(t) ? 2 : 0;
    const score = words.filter((w) => t.includes(w)).length + (unitMatch ? 2 : 0) + aliases;
    if (score > bestScore) { bestScore = score; best = s.id; }
  });
  return bestScore > 0 ? best : null;
}

function estimateForQuery(ds, query) {
  const countMatch = query.match(/(\d+)/);
  const count = countMatch ? parseInt(countMatch[1], 10) : null;
  const schemeId = findSchemeByFuzzyMatch(ds, query);
  const districtMatch = ds.districts.find((d) => query.toLowerCase().includes(d.toLowerCase()));
  if (!schemeId || !count) return { error: true };
  const cost = estimateUnitCost(ds, schemeId, count);
  if (!cost) return { error: true, noUnitCost: true, scheme: schemeInfo(ds, schemeId) };
  const validation = validateAgainstHistory(ds, cost.totalCr, schemeId);
  const aspiration = recommendAspiration(ds, cost.totalCr, schemeId, validation.confidence);
  return { scheme: schemeInfo(ds, schemeId), count, district: districtMatch, cost, validation, aspiration };
}

function projectNonUnitCostScheme(ds, schemeId) {
  const hist = schemeHistory(ds, schemeId).filter((h) => h.sanctioned !== null);
  if (!hist.length) return { conservative: 0, realistic: 0, ambitious: 0, growthPct: 0 };
  const growth = cagr(hist.map((h) => h.sanctioned));
  const latest = hist[hist.length - 1].sanctioned;
  const realistic = latest * (1 + growth);
  return { conservative: Math.round(realistic * 0.96 * 10) / 10, realistic: Math.round(realistic * 10) / 10, ambitious: Math.round(realistic * 1.06 * 10) / 10, growthPct: Math.round(growth * 1000) / 10 };
}

const DEFAULT_NEXT_YEAR_UNITS = {
  school_construction: 220, phc_construction: 18, road_widening: 340, bridge_construction: 9,
  canal_lining: 65, tubewell_installation: 140, gp_building: 55, cold_storage: 12, heritage_restoration: 6,
};

function projectDepartmentBudget(ds, deptId) {
  const dept = ds.departments.find((d) => d.id === deptId);
  const schemes = ds.schemesByDept[deptId] || [];
  const lines = schemes.map((s) => {
    if (s.category === "Capital" && ds.unitCosts[s.id]) {
      const units = DEFAULT_NEXT_YEAR_UNITS[s.id] || Math.max(10, Math.round(s.base / 10));
      const cost = estimateUnitCost(ds, s.id, units);
      const validation = validateAgainstHistory(ds, cost.totalCr, s.id);
      const aspiration = recommendAspiration(ds, cost.totalCr, s.id, validation.confidence);
      return { scheme: s, method: "unit-cost", units, unitLabel: cost.unitLabel, ...aspiration };
    }
    const proj = projectNonUnitCostScheme(ds, s.id);
    return { scheme: s, method: "trend", ...proj };
  });
  const totals = { conservative: 0, realistic: 0, ambitious: 0 };
  lines.forEach((l) => { totals.conservative += l.conservative; totals.realistic += l.realistic; totals.ambitious += l.ambitious; });
  Object.keys(totals).forEach((k) => (totals[k] = Math.round(totals[k] * 10) / 10));
  return { dept, lines, totals };
}

function projectFullStateBudget(ds) {
  const deptProjections = ds.departments.map((d) => projectDepartmentBudget(ds, d.id));
  const totals = { conservative: 0, realistic: 0, ambitious: 0 };
  deptProjections.forEach((dp) => { totals.conservative += dp.totals.conservative; totals.realistic += dp.totals.realistic; totals.ambitious += dp.totals.ambitious; });
  Object.keys(totals).forEach((k) => (totals[k] = Math.round(totals[k] * 10) / 10));
  return { deptProjections, totals };
}

function findDeptByFuzzyMatch(ds, text) {
  const t = text.toLowerCase();
  return ds.departments.find((d) => t.includes(d.name.toLowerCase().split(" ")[0].toLowerCase()) || t.includes(d.id.replace(/_/g, " ")));
}

function answerQuestion(ds, query, scopedDeptId) {
  const t = query.toLowerCase();
  const scoped = scopedDeptId ? ds.departments.find((d) => d.id === scopedDeptId) : null;
  const dept = scoped || findDeptByFuzzyMatch(ds, query);

  if (/\d+/.test(t) && findSchemeByFuzzyMatch(ds, t)) {
    const est = estimateForQuery(ds, query);
    if (!est.error) {
      return {
        kind: "estimate",
        text: `${est.count} ${est.cost.unitLabel}${est.count > 1 ? "s" : ""} of ${est.scheme.name.toLowerCase()} would cost approximately ${CR(est.cost.totalCr)} at current rates. The direct rate is ₹${est.cost.perUnitLakh} lakh per ${est.cost.unitLabel}, including material, labour, and contingency. Accounting for typical spending patterns, a realistic budget to set aside is ${CR(est.aspiration.realistic)}.`,
        computedFacts: `Count: ${est.count} ${est.cost.unitLabel}s. Direct total: ${CR(est.cost.totalCr)}. Rate: ₹${est.cost.perUnitLakh} lakh per ${est.cost.unitLabel}. Breakdown: material ₹${est.cost.breakdown.material} lakh, labour ₹${est.cost.breakdown.labor} lakh, contingency ₹${est.cost.breakdown.contingency} lakh. Realistic reserve: ${CR(est.aspiration.realistic)}.`,
        scenarios: est.aspiration,
      };
    }
  }

  if (t.includes("underspend") || t.includes("under spend") || t.includes("underutil") || t.includes("not us")) {
    const pool = scoped ? (ds.schemesByDept[scoped.id] || []).map((s) => ({ ...s, dept: scoped })) : ds.departments.flatMap((d) => (ds.schemesByDept[d.id] || []).map((s) => ({ ...s, dept: d })));
    const rows = pool.map((s) => {
      const hist = schemeHistory(ds, s.id).filter((h) => h.utilization !== null);
      const avgUtil = hist.length ? hist.reduce((a, b) => a + b.utilization, 0) / hist.length : null;
      return { dept: s.dept.name, scheme: s.name, avgUtil };
    }).filter((r) => r.avgUtil !== null).sort((a, b) => a.avgUtil - b.avgUtil);
    const worst = rows.slice(0, 5);
    return {
      kind: "list",
      text: worst.length ? `${worst[0].scheme}${scoped ? "" : ` (${worst[0].dept})`} has used the smallest share of its budget, at ${worst[0].avgUtil.toFixed(0)}%. Here are the schemes using the least of their allocation:` : "No utilization data is available yet to answer this.",
      rows: worst,
    };
  }

  if (t.includes("trend") || t.includes("5 year") || t.includes("5-year") || t.includes("over time") || t.includes("growth")) {
    if (dept) {
      const byYear = ds.years.map((year) => ({ year, value: Math.round(ds.sanctioned.filter((r) => r.dept === dept.id && r.year === year).reduce((a, b) => a + b.sanctioned, 0)) }));
      const growth = cagr(byYear.map((b) => b.value));
      return {
        kind: "chart", chartType: "area",
        text: `${dept.name}'s budget has moved at roughly ${(growth * 100).toFixed(1)}% a year, reaching ${CR(byYear[byYear.length - 1].value)} in the latest year on record.`,
        data: byYear, color: dept.color,
      };
    }
  }

  if (t.includes("compar") || t.includes(" vs ") || t.includes("versus")) {
    const list = scoped ? [scoped] : ds.departments;
    const latestYear = ds.years[ds.years.length - 1];
    const rows = list.map((d) => ({ department: d.name, value: Math.round(ds.sanctioned.filter((r) => r.dept === d.id && r.year === latestYear).reduce((a, b) => a + b.sanctioned, 0)), fill: d.color })).sort((a, b) => b.value - a.value);
    return {
      kind: "chart", chartType: "bar",
      text: `${rows[0].department} has the largest allocation at ${CR(rows[0].value)}${rows.length > 1 ? `, ahead of ${rows[1].department} at ${CR(rows[1].value)}` : ""}.`,
      data: rows,
    };
  }

  if (scoped) {
    const latestYear = ds.years[ds.years.length - 1];
    const latest = ds.sanctioned.filter((r) => r.dept === scoped.id && r.year === latestYear).reduce((a, b) => a + b.sanctioned, 0);
    return { kind: "text", text: `${scoped.name}'s total budget for the latest year on record is ${CR(Math.round(latest))}. Ask about a specific scheme, a trend over time, or a comparison with another department for more detail.` };
  }

  const latestYear = ds.years[ds.years.length - 1];
  const cats = Array.from(new Set(ds.sanctioned.map((r) => r.category)));
  const byCategory = cats.map((cat) => ({ name: cat, value: Math.round(ds.sanctioned.filter((r) => r.category === cat && r.year === latestYear).reduce((a, b) => a + b.sanctioned, 0)) }));
  return { kind: "chart", chartType: "pie", text: "Here is how the current budget splits across categories.", data: byCategory };
}

const CR = (n) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`;
const PIE_COLORS = ["#2E74B5", "#B5762E", "#3E8E7E", "#7A4EA8"];
const INK = "#1A2233";
const MUTE = "#8A93A6";
const CARD_BORDER = "#E8EAEF";
const BG = "#F6F7FA";

function Card({ children, style = {}, padding = 22 }) {
  return <div style={{ background: "#fff", border: `1px solid ${CARD_BORDER}`, borderRadius: 16, padding, boxShadow: "0 1px 2px rgba(20,25,40,0.04)", ...style }}>{children}</div>;
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTE, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>{children}</div>;
}

function StatCard({ label, value, sub, trend, accent }) {
  return (
    <Card padding={18}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ fontSize: 24, fontWeight: 750, color: accent || INK, letterSpacing: -0.3 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: MUTE, marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
        {trend === "up" && <TrendingUp size={13} color="#3E8E7E" />}
        {trend === "down" && <TrendingDown size={13} color="#C0554A" />}
        {trend === "flat" && <Minus size={13} color={MUTE} />}
        {sub}
      </div>}
    </Card>
  );
}

const selectStyle = { padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${CARD_BORDER}`, fontSize: 13.5, background: "#fff", color: INK, cursor: "pointer", fontWeight: 600 };

function ScenarioRow({ scenarios, chosen, onChoose }) {
  const items = [{ key: "conservative", label: "Conservative", color: "#B5762E" }, { key: "realistic", label: "Realistic", color: "#2E5FB5" }, { key: "ambitious", label: "Ambitious", color: "#3E8E7E" }];
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {items.map((it) => (
        <button key={it.key} onClick={() => onChoose && onChoose(it.key)} style={{ flex: 1, textAlign: "left", cursor: onChoose ? "pointer" : "default", border: `1.5px solid ${chosen === it.key ? it.color : CARD_BORDER}`, background: chosen === it.key ? `${it.color}0F` : "#FAFBFC", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: chosen === it.key ? it.color : MUTE, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>{it.label}</div>
          <div style={{ fontSize: 18, fontWeight: 750, color: INK }}>{CR(scenarios[it.key])}</div>
        </button>
      ))}
    </div>
  );
}

const DataSourceContext = React.createContext(null);
function useDataSource() { return React.useContext(DataSourceContext); }

function parseFile(file, onDone, onError) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "csv") {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => onDone(res.data, res.meta.fields || []),
      error: (err) => onError(err.message),
    });
  } else if (ext === "xlsx" || ext === "xls") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const headers = json.length ? Object.keys(json[0]) : [];
        onDone(json, headers);
      } catch { onError("Could not read this file. Check that it's a valid Excel file."); }
    };
    reader.onerror = () => onError("Could not read this file.");
    reader.readAsBinaryString(file);
  } else if (ext === "json") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : []);
        const headers = rows.length && typeof rows[0] === "object" ? Object.keys(rows[0]) : [];
        if (!rows.length || !headers.length) throw new Error("JSON must contain an array of objects.");
        onDone(rows, headers);
      } catch { onError("Could not read this JSON file. Use an array of objects or { data: [...] }."); }
    };
    reader.onerror = () => onError("Could not read this file.");
    reader.readAsText(file);
  } else if (ext === "txt" || ext === "md") {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target.result || "").trim();
      if (!text) { onError("This text file appears to be empty."); return; }
      onDone(text.split(/\r?\n/).filter(Boolean).map((line, index) => ({ department: "General", scheme: `Text record ${index + 1}`, category: "Reference", year: "Current", sanctioned: 1, notes: line })), ["department", "scheme", "category", "year", "sanctioned", "notes"]);
    };
    reader.onerror = () => onError("Could not read this file.");
    reader.readAsText(file);
  } else {
    onError("Supported formats are CSV, Excel, JSON, TXT, and Markdown.");
  }
}

function UploadView({ onDataReady }) {
  const [stage, setStage] = useState("idle");
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [errorMsg, setErrorMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);

  function handleFile(file) {
    setFileName(file.name);
    setErrorMsg("");
    parseFile(file, (rows, hdrs) => {
      if (!rows.length || !hdrs.length) { setErrorMsg("This file appears to be empty."); setStage("error"); return; }
      setRawRows(rows);
      setHeaders(hdrs);
      setMapping(guessColumnMapping(hdrs));
      setStage("mapping");
    }, (msg) => { setErrorMsg(msg); setStage("error"); });
  }

  function confirmMapping() {
    if (!mapping.department && !mapping.scheme) {
      setErrorMsg("Map at least a department or scheme column so records can be grouped.");
      return;
    }
    const ds = parseUploadedRows(rawRows, mapping);
    onDataReady(ds, fileName);
  }

  const FIELD_LABELS = {
    department: "Department", scheme: "Scheme / Line Item", category: "Category (Capital, Salary...)",
    year: "Fiscal Year", sanctioned: "Sanctioned / Budgeted Amount", actual: "Actual Spend",
    unit: "Unit Count (e.g. no. of rooms)", unitCost: "Cost Per Unit", district: "District",
  };

  if (stage === "mapping") {
    return (
      <Card style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <FileSpreadsheet size={19} color="#2E5FB5" />
          <div style={{ fontWeight: 750, fontSize: 15.5, color: INK }}>Confirm what each column means</div>
        </div>
        <div style={{ fontSize: 13, color: MUTE, marginBottom: 18 }}>{fileName} &middot; {rawRows.length} rows found. We've guessed the mapping below, adjust anything that looks wrong.</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {Object.entries(FIELD_LABELS).map(([field, label]) => (
            <div key={field} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 210, fontSize: 13, color: "#444", fontWeight: 600 }}>{label}</div>
              <select value={mapping[field] || ""} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))} style={{ ...selectStyle, flex: 1 }}>
                <option value="">Not in this file</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
        </div>

        {errorMsg && <div style={{ display: "flex", gap: 8, color: "#A85400", background: "#FFF6EA", padding: 12, borderRadius: 10, fontSize: 13, marginBottom: 14 }}><AlertCircle size={16} style={{ flexShrink: 0 }} />{errorMsg}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setStage("idle")} style={{ padding: "11px 18px", borderRadius: 10, border: `1.5px solid ${CARD_BORDER}`, background: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", color: "#555" }}>Start over</button>
          <button onClick={confirmMapping} style={{ flex: 1, padding: "11px 18px", borderRadius: 10, border: "none", background: INK, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>Load this data and analyze</button>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ maxWidth: 620, margin: "0 auto", textAlign: "center" }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
        style={{ border: `2px dashed ${dragOver ? "#2E5FB5" : "#D5D9E0"}`, borderRadius: 16, padding: "44px 24px", background: dragOver ? "#F2F6FC" : "#FAFBFC" }}
      >
        <UploadCloud size={34} color={dragOver ? "#2E5FB5" : "#A6ACB8"} style={{ marginBottom: 14 }} />
        <div style={{ fontWeight: 750, fontSize: 16, color: INK, marginBottom: 6 }}>Upload your department's budget data</div>
        <div style={{ fontSize: 13, color: MUTE, marginBottom: 18, maxWidth: 380, marginInline: "auto", lineHeight: 1.6 }}>
          CSV, Excel, JSON, TXT, and Markdown files are supported. Structured files can include department, scheme, year, budget, and actual-spend columns. We will confirm the mapping before analysis.
        </div>
        <label style={{ display: "inline-block", background: INK, color: "#fff", padding: "11px 22px", borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
          Choose file
          <input type="file" accept=".csv,.xlsx,.xls,.json,.txt,.md" style={{ display: "none" }} onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
        </label>
      </div>
      {stage === "error" && <div style={{ display: "flex", gap: 8, color: "#A85400", background: "#FFF6EA", padding: 12, borderRadius: 10, fontSize: 13, marginTop: 14, textAlign: "left" }}><AlertCircle size={16} style={{ flexShrink: 0 }} />{errorMsg}</div>}
      <div style={{ fontSize: 12, color: MUTE, marginTop: 16 }}>Don't have a file handy? Continue exploring with the built-in demo dataset from the menu above.</div>
    </Card>
  );
}

function AskWidget({ scopeLabel, scopeDeptId, suggestions, accentColor = "#2E5FB5" }) {
  const ds = useDataSource();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [thread, setThread] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [requestError, setRequestError] = useState("");

  async function ask(q) {
    const text = (q || query).trim();
    if (!text) return;
    setQuery(""); setThinking(true); setRequestError("");

    const localAnswer = answerQuestion(ds, text, scopeDeptId);
    setThread((threadItems) => [...threadItems, { q: text, a: { ...localAnswer, sources: [] } }]);
    try {
      const summary = buildDataSummary(ds, scopeDeptId);
      const computed = localAnswer.computedFacts || summarizeComputedAnswer(localAnswer);
      const phrased = await streamAskGemini(text, summary, computed, scopeDeptId, scopeLabel, (token, completeText) => {
        setThread((threadItems) => threadItems.map((item, index) => index === threadItems.length - 1 ? { ...item, a: { ...item.a, text: completeText } } : item));
      });
      setThread((threadItems) => threadItems.map((item, index) => index === threadItems.length - 1 ? { ...item, a: { ...localAnswer, text: phrased.text, sources: phrased.sources } } : item));
    } catch (error) {
      setRequestError(error.message || "The assistant could not reach the AI service. Showing the locally computed answer.");
      setThread((threadItems) => threadItems.map((item, index) => index === threadItems.length - 1 ? { ...item, a: localAnswer } : item));
    }
    setThinking(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: `1.5px solid ${accentColor}33`, color: accentColor, padding: "10px 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 1px 3px rgba(20,25,40,0.06)" }}>
        <MessageCircle size={15} /> Ask about {scopeLabel}
      </button>
    );
  }

  return (
    <Card padding={0} style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${CARD_BORDER}`, background: "#FAFBFC" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: INK }}><MessageCircle size={15} color={accentColor} /> Ask about {scopeLabel}</div>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: MUTE, padding: 4 }}><X size={16} /></button>
      </div>
      <div style={{ padding: 18 }}>
        {thread.length === 0 && !thinking && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
            {suggestions.map((s, i) => <button key={i} onClick={() => ask(s)} style={{ fontSize: 12.5, background: "#F4F5F7", border: `1px solid ${CARD_BORDER}`, borderRadius: 999, padding: "6px 13px", cursor: "pointer", color: "#444" }}>{s}</button>)}
          </div>
        )}
        <div style={{ minHeight: 210, display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
          {thread.map((item, i) => (
            <div key={i}>
              <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 8 }}>{item.q}</div>
              <AnswerBlock answer={item.a} accentColor={accentColor} />
            </div>
          ))}
          {thinking && <div style={{ fontSize: 13, color: MUTE, display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={14} className="pulse" /> Looking into the data...</div>}
        </div>
        {requestError && <div role="status" style={{ color: "#A85400", background: "#FFF6EA", border: "1px solid #F1D4AE", borderRadius: 10, padding: "9px 11px", fontSize: 12.5, lineHeight: 1.45, marginBottom: 12 }}>{requestError}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Type a question..." style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${CARD_BORDER}`, fontSize: 13.5, outline: "none" }} />
          <button onClick={() => ask()} style={{ background: accentColor, color: "#fff", border: "none", borderRadius: 10, width: 42, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Send size={15} /></button>
        </div>
      </div>
    </Card>
  );
}

function AnswerBlock({ answer, accentColor }) {
  return (
    <div>
      <p style={{ fontSize: 13.5, color: "#3D4456", lineHeight: 1.6, margin: "0 0 12px" }}>{answer.text}</p>
      {answer.sources?.length > 0 && (
        <details style={{ marginBottom: 12, color: MUTE, fontSize: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>View retrieved source evidence ({answer.sources.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {answer.sources.map((source) => <div key={`${source.fileName}-${source.index}`} style={{ padding: "8px 10px", background: "#F7F8FA", borderRadius: 8 }}><strong>{source.fileName}, passage {source.index}</strong><div style={{ marginTop: 4, lineHeight: 1.5 }}>{source.text}</div></div>)}
          </div>
        </details>
      )}
      {answer.kind === "estimate" && <ScenarioRow scenarios={answer.scenarios} chosen="realistic" />}
      {answer.kind === "list" && answer.rows && answer.rows.length > 0 && (
        <div>{answer.rows.map((r, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < answer.rows.length - 1 ? "1px solid #F0F1F4" : "none" }}>
            <div style={{ fontSize: 13 }}><span style={{ fontWeight: 600 }}>{r.scheme}</span>{r.dept && <span style={{ color: MUTE }}> &middot; {r.dept}</span>}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: r.avgUtil < 92 ? "#C0554A" : "#3E8E7E", background: r.avgUtil < 92 ? "#FBEDEA" : "#EBF6F1", padding: "3px 10px", borderRadius: 999 }}>{r.avgUtil.toFixed(0)}%</div>
          </div>
        ))}</div>
      )}
      {answer.kind === "chart" && answer.chartType === "area" && (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={answer.data}>
            <defs><linearGradient id="askGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={answer.color} stopOpacity={0.35} /><stop offset="100%" stopColor={answer.color} stopOpacity={0} /></linearGradient></defs>
            <XAxis dataKey="year" fontSize={11} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip formatter={(v) => `₹${v} Cr`} />
            <Area type="monotone" dataKey="value" stroke={answer.color} strokeWidth={2.2} fill="url(#askGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
      {answer.kind === "chart" && answer.chartType === "bar" && (
        <ResponsiveContainer width="100%" height={Math.max(120, answer.data.length * 34)}>
          <BarChart data={answer.data} layout="vertical" margin={{ left: 8 }}>
            <XAxis type="number" hide /><YAxis type="category" dataKey="department" fontSize={11.5} width={130} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => `₹${v} Cr`} />
            <Bar dataKey="value" radius={[0, 5, 5, 0]} barSize={16}>{answer.data.map((e, i) => <Cell key={i} fill={e.fill || accentColor} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {answer.kind === "chart" && answer.chartType === "pie" && (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart><Pie data={answer.data} dataKey="value" nameKey="name" outerRadius={75} label={(e) => e.name}>{answer.data.map((e, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip formatter={(v) => `₹${v} Cr`} /></PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function MicroCalculator() {
  const ds = useDataSource();
  const unitCostSchemes = useMemo(() => Object.values(ds.schemesByDept).flat().filter((s) => ds.unitCosts[s.id]), [ds]);
  const [schemeId, setSchemeId] = useState(unitCostSchemes[0]?.id || "");
  const [count, setCount] = useState(100);
  if (!unitCostSchemes.length) {
    return <Card><div style={{ fontSize: 13.5, color: MUTE }}>No per-unit cost data (like cost per classroom or per km) was found in this dataset, so a micro-level calculator isn't available yet. Map a "cost per unit" column when uploading to enable this.</div></Card>;
  }

  const cost = estimateUnitCost(ds, schemeId, count);
  const validation = cost ? validateAgainstHistory(ds, cost.totalCr, schemeId) : null;
  const aspiration = cost && validation ? recommendAspiration(ds, cost.totalCr, schemeId, validation.confidence) : null;

  return (
    <Card>
      <SectionLabel>Micro-Level Construction Cost Calculator</SectionLabel>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 220 }}>
          {unitCostSchemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="number" min={1} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} style={{ width: 120, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${CARD_BORDER}`, fontSize: 13.5 }} />
        <div style={{ display: "flex", alignItems: "center", fontSize: 13, color: MUTE, fontWeight: 600 }}>{cost?.unitLabel || "units"}</div>
      </div>
      {cost && (
        <>
          <div className="responsive-grid responsive-grid--two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: MUTE, marginBottom: 4 }}>Cost per {cost.unitLabel}</div>
              <div style={{ fontSize: 20, fontWeight: 750 }}>{`₹${cost.perUnitLakh}L`}</div>
              <div style={{ fontSize: 11.5, color: MUTE, marginTop: 6 }}>Material ₹{cost.breakdown.material}L &middot; Labour ₹{cost.breakdown.labor}L &middot; Contingency ₹{cost.breakdown.contingency}L</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: MUTE, marginBottom: 4 }}>Direct cost for {count} {cost.unitLabel}s</div>
              <div style={{ fontSize: 20, fontWeight: 750 }}>{CR(cost.totalCr)}</div>
            </div>
          </div>
          {aspiration && (
            <>
              <div style={{ fontSize: 12, color: MUTE, marginBottom: 8 }}>Recommended budget to actually set aside, accounting for typical utilization and growth:</div>
              <ScenarioRow scenarios={aspiration} chosen="realistic" />
            </>
          )}
        </>
      )}
    </Card>
  );
}

function HomeView({ goTo }) {
  const ds = useDataSource();
  const state = useMemo(() => projectFullStateBudget(ds), [ds]);
  const latestYear = ds.years[ds.years.length - 1];
  const currentTotal = ds.departments.reduce((sum, d) => sum + ds.sanctioned.filter((r) => r.dept === d.id && r.year === latestYear).reduce((a, b) => a + b.sanctioned, 0), 0);

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 26, fontWeight: 750, color: INK, letterSpacing: -0.5 }}>Budget Intelligence</div>
          {ds.isUploaded && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3E8E7E", background: "#EBF6F1", padding: "4px 11px", borderRadius: 999 }}>Using your uploaded data</span>}
        </div>
        <div style={{ fontSize: 14.5, color: MUTE }}>Explore past spending, ask questions in plain language, and build the next budget for any department, sector, or the whole state.</div>
      </div>

      <div className="responsive-grid responsive-grid--three" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
        <StatCard label={`Current Budget (${latestYear})`} value={CR(Math.round(currentTotal))} sub={`Across ${ds.departments.length} departments`} />
        <StatCard label="Projected Next Year (Realistic)" value={CR(state.totals.realistic)} sub={currentTotal > 0 ? `${(((state.totals.realistic - currentTotal) / currentTotal) * 100).toFixed(1)}% change` : ""} trend="up" />
        <StatCard label="Schemes Tracked" value={Object.values(ds.schemesByDept).flat().length} sub={ds.label} />
      </div>

      <div className="responsive-grid responsive-grid--two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
        <button onClick={() => goTo("secretary")} style={navCardStyle}>
          <Building2 size={20} color="#2E5FB5" />
          <div><div style={{ fontWeight: 700, fontSize: 14.5, color: INK }}>Department Planning</div><div style={{ fontSize: 12.5, color: MUTE, marginTop: 2 }}>Scheme-level detail, trends, and micro-cost calculator</div></div>
          <ChevronRight size={17} color={MUTE} style={{ marginLeft: "auto" }} />
        </button>
        <button onClick={() => goTo("ministry")} style={navCardStyle}>
          <Landmark size={20} color="#7A4EA8" />
          <div><div style={{ fontWeight: 700, fontSize: 14.5, color: INK }}>State Overview</div><div style={{ fontSize: 12.5, color: MUTE, marginTop: 2 }}>Cross-department comparison and full state budget</div></div>
          <ChevronRight size={17} color={MUTE} style={{ marginLeft: "auto" }} />
        </button>
      </div>

      <Card>
        <SectionLabel>Ask about the budget</SectionLabel>
        <AskWidget scopeLabel="the budget" suggestions={["What was the 5-year trend?", "Which schemes underspent last year?", "Compare the top two departments"]} accentColor="#7A4EA8" />
      </Card>
    </div>
  );
}
const navCardStyle = { display: "flex", alignItems: "center", gap: 14, background: "#fff", border: `1px solid ${CARD_BORDER}`, borderRadius: 16, padding: "18px 20px", cursor: "pointer", textAlign: "left", boxShadow: "0 1px 2px rgba(20,25,40,0.04)" };

function SecretaryView() {
  const ds = useDataSource();
  const [deptId, setDeptId] = useState(ds.departments[0]?.id);
  const [schemeId, setSchemeId] = useState((ds.schemesByDept[ds.departments[0]?.id] || [])[0]?.id);
  const [showCalc, setShowCalc] = useState(false);
  const dept = ds.departments.find((d) => d.id === deptId);
  const schemes = ds.schemesByDept[deptId] || [];
  const scheme = schemes.find((s) => s.id === schemeId) || schemes[0];

  if (!dept || !scheme) return <Card>No data available for this selection.</Card>;

  const history = schemeHistory(ds, scheme.id);
  const utilRows = history.filter((h) => h.utilization !== null);
  const avgUtil = utilRows.length ? utilRows.reduce((a, b) => a + b.utilization, 0) / utilRows.length : null;
  const unitCost = ds.unitCosts[scheme.id];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select value={deptId} onChange={(e) => { setDeptId(e.target.value); setSchemeId((ds.schemesByDept[e.target.value] || [])[0]?.id); }} style={selectStyle}>
            {ds.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)} style={selectStyle}>
            {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowCalc(!showCalc)} style={{ display: "flex", alignItems: "center", gap: 8, background: showCalc ? INK : "#fff", color: showCalc ? "#fff" : INK, border: `1.5px solid ${showCalc ? INK : CARD_BORDER}`, padding: "10px 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            <Calculator size={15} /> Cost Calculator
          </button>
          <AskWidget scopeLabel={scheme.name} scopeDeptId={deptId} accentColor={dept.color} suggestions={[unitCost ? `Estimate 50 more ${unitCost.unitLabel}s` : "How has this scheme performed?", "Compare with other schemes", "What is the 5 year trend?"]} />
        </div>
      </div>

      {showCalc && <div style={{ marginBottom: 20 }}><MicroCalculator /></div>}

      <div className="responsive-grid responsive-grid--three" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
        <StatCard label="Category" value={scheme.category} sub={unitCost ? `Priced per ${unitCost.unitLabel}` : "Trend-based projection"} />
        <StatCard label="Latest Budget" value={history.length ? CR(history[history.length - 1].sanctioned) : "No data"} sub={history.length > 1 ? `${CR(history[0].sanctioned)} at start of record` : ""} trend="up" />
        <StatCard label="Typical Utilization" value={avgUtil !== null ? `${avgUtil.toFixed(0)}%` : "N/A"} sub="Share of budget actually spent" accent={avgUtil !== null && avgUtil < 92 ? "#C0554A" : "#3E8E7E"} />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <SectionLabel>Budget vs. Actual Spending</SectionLabel>
        {history.length ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F4" vertical={false} />
              <XAxis dataKey="year" fontSize={12} axisLine={false} tickLine={false} />
              <YAxis fontSize={12} width={40} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => (v !== null ? `₹${v} Cr` : "Not yet available")} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12.5 }} />
              <Line type="monotone" dataKey="sanctioned" name="Budgeted" stroke={dept.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="actual" name="Actually Spent" stroke="#C0554A" strokeWidth={2.5} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : <div style={{ fontSize: 13, color: MUTE }}>No historical rows found for this scheme.</div>}
      </Card>

      {unitCost && (
        <Card>
          <SectionLabel>What one {unitCost.unitLabel} costs</SectionLabel>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={[{ name: "x", Material: unitCost.material, Labour: unitCost.labor, Contingency: Math.round(unitCost.material * (unitCost.contingencyPct / 100) * 100) / 100 }]} layout="vertical">
              <XAxis type="number" hide /><YAxis type="category" dataKey="name" hide />
              <Tooltip formatter={(v) => `₹${v} lakh`} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12.5 }} />
              <Bar dataKey="Material" stackId="a" fill="#2E5FB5" radius={[6, 0, 0, 6]} barSize={28} />
              <Bar dataKey="Labour" stackId="a" fill="#3E8E7E" barSize={28} />
              <Bar dataKey="Contingency" stackId="a" fill="#B5762E" radius={[0, 6, 6, 0]} barSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

function MinistryView() {
  const [subview, setSubview] = useState("overview");
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 6, background: "#EDEEF2", padding: 4, borderRadius: 11 }}>
          {[{ id: "overview", label: "Overview" }, { id: "sector", label: "By Sector" }, { id: "full", label: "Full State Budget" }].map((t) => (
            <button key={t.id} onClick={() => setSubview(t.id)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: subview === t.id ? "#fff" : "transparent", color: subview === t.id ? INK : MUTE, boxShadow: subview === t.id ? "0 1px 3px rgba(20,25,40,0.1)" : "none" }}>{t.label}</button>
          ))}
        </div>
        <AskWidget scopeLabel="the state budget" accentColor="#7A4EA8" suggestions={["Compare all departments", "Which sectors underspent?", "What is the overall trend?"]} />
      </div>
      {subview === "overview" && <MinistryOverview />}
      {subview === "sector" && <SectorView />}
      {subview === "full" && <FullStateBudget />}
    </div>
  );
}

function MinistryOverview() {
  const ds = useDataSource();
  const latestYear = ds.years[ds.years.length - 1];
  const byDeptLatest = ds.departments.map((d) => ({ department: d.name, sanctioned: Math.round(ds.sanctioned.filter((r) => r.dept === d.id && r.year === latestYear).reduce((a, b) => a + b.sanctioned, 0)), fill: d.color })).sort((a, b) => b.sanctioned - a.sanctioned);
  const stateTotal = byDeptLatest.reduce((a, b) => a + b.sanctioned, 0);
  const FISCAL_ENVELOPE = ds.isUploaded ? Math.round(stateTotal * 1.15) : 2900;

  const trendByYear = ds.years.map((year) => {
    const row = { year };
    ds.departments.forEach((d) => { row[d.name] = Math.round(ds.sanctioned.filter((r) => r.dept === d.id && r.year === year).reduce((a, b) => a + b.sanctioned, 0)); });
    return row;
  });

  const underspend = ds.departments.flatMap((d) => (ds.schemesByDept[d.id] || []).map((s) => {
    const hist = schemeHistory(ds, s.id).filter((h) => h.utilization !== null);
    const avgUtil = hist.length ? hist.reduce((a, b) => a + b.utilization, 0) / hist.length : null;
    return { dept: d.name, scheme: s.name, avgUtil, color: d.color };
  })).filter((r) => r.avgUtil !== null).sort((a, b) => a.avgUtil - b.avgUtil).slice(0, 5);

  return (
    <div>
      <div className="responsive-grid responsive-grid--three" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
        <StatCard label="This Year's Total" value={CR(stateTotal)} sub="Across all departments" />
        <StatCard label="Fiscal Ceiling" value={CR(FISCAL_ENVELOPE)} sub={stateTotal > FISCAL_ENVELOPE ? "Current spend exceeds ceiling" : "Within approved ceiling"} accent={stateTotal > FISCAL_ENVELOPE ? "#C0554A" : "#3E8E7E"} />
        <StatCard label="Departments" value={ds.departments.length} sub={`${Object.values(ds.schemesByDept).flat().length} schemes`} />
      </div>
      <Card style={{ marginBottom: 16 }}>
        <SectionLabel>Departments Compared &middot; Latest Year</SectionLabel>
        {byDeptLatest.length ? (
          <ResponsiveContainer width="100%" height={Math.max(180, byDeptLatest.length * 42)}>
            <BarChart data={byDeptLatest} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F4" horizontal={false} />
              <XAxis type="number" fontSize={12} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="department" fontSize={12} width={190} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => `₹${v} Cr`} />
              <Bar dataKey="sanctioned" radius={[0, 6, 6, 0]} barSize={20}>{byDeptLatest.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <div style={{ fontSize: 13, color: MUTE }}>No data to show yet.</div>}
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <SectionLabel>Trend Over Time</SectionLabel>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trendByYear}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F4" vertical={false} />
            <XAxis dataKey="year" fontSize={12} axisLine={false} tickLine={false} />
            <YAxis fontSize={12} width={40} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => `₹${v} Cr`} />
            <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" />
            {ds.departments.map((d) => <Line key={d.id} type="monotone" dataKey={d.name} stroke={d.color} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />)}
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <SectionLabel>Schemes Using the Least of Their Budget</SectionLabel>
        {underspend.length ? underspend.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < underspend.length - 1 ? "1px solid #F0F1F4" : "none" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13.5 }}><span style={{ fontWeight: 600 }}>{r.scheme}</span><span style={{ color: MUTE }}> &middot; {r.dept}</span></div>
            <div style={{ fontSize: 13, fontWeight: 700, color: r.avgUtil < 92 ? "#C0554A" : "#3E8E7E", background: r.avgUtil < 92 ? "#FBEDEA" : "#EBF6F1", padding: "3px 11px", borderRadius: 999 }}>{r.avgUtil.toFixed(0)}%</div>
          </div>
        )) : <div style={{ fontSize: 13, color: MUTE }}>No actual-spend data available to compute utilization yet.</div>}
      </Card>
    </div>
  );
}

function SectorView() {
  const ds = useDataSource();
  const [sectorId, setSectorId] = useState(ds.departments[0]?.id);
  const sector = ds.departments.find((d) => d.id === sectorId);
  const projection = useMemo(() => (sector ? projectDepartmentBudget(ds, sectorId) : null), [ds, sector, sectorId]);
  const history = ds.years.map((year) => ({ year, value: Math.round(ds.sanctioned.filter((r) => r.dept === sectorId && r.year === year).reduce((a, b) => a + b.sanctioned, 0)) }));

  if (!sector) return <Card>No departments found in this dataset.</Card>;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        {ds.departments.map((d) => (
          <button key={d.id} onClick={() => setSectorId(d.id)} style={{ padding: "9px 15px", borderRadius: 10, border: `1.5px solid ${sectorId === d.id ? d.color : CARD_BORDER}`, background: sectorId === d.id ? `${d.color}12` : "#fff", color: sectorId === d.id ? d.color : "#555", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{d.sector}</button>
        ))}
      </div>
      <div className="responsive-grid responsive-grid--two" style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }}>
        <Card>
          <SectionLabel>{sector.sector} &middot; Trend</SectionLabel>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={history}>
              <defs><linearGradient id="sectorGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={sector.color} stopOpacity={0.3} /><stop offset="100%" stopColor={sector.color} stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="year" fontSize={11.5} axisLine={false} tickLine={false} />
              <YAxis fontSize={11.5} width={38} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => `₹${v} Cr`} />
              <Area type="monotone" dataKey="value" stroke={sector.color} strokeWidth={2.3} fill="url(#sectorGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionLabel>Next Period Projection (Realistic)</SectionLabel>
          <div style={{ fontSize: 30, fontWeight: 750, color: INK, marginBottom: 14 }}>{CR(projection.totals.realistic)}</div>
          <div style={{ fontSize: 12.5, color: MUTE, marginBottom: 4 }}>Made up of {projection.lines.length} schemes:</div>
          {projection.lines.map((l) => (
            <div key={l.scheme.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0", color: "#444" }}><span>{l.scheme.name}</span><span style={{ fontWeight: 600 }}>{CR(l.realistic)}</span></div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function FullStateBudget() {
  const ds = useDataSource();
  const [scenario, setScenario] = useState("realistic");
  const state = useMemo(() => projectFullStateBudget(ds), [ds]);
  const pieData = state.deptProjections.map((dp) => ({ name: dp.dept.sector, value: dp.totals[scenario], fill: dp.dept.color }));

  return (
    <div>
      <Card style={{ marginBottom: 16, background: "linear-gradient(135deg, #1A2233, #2B3B5C)", border: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#B9C4DE", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Full State Budget &middot; Next Period Proposal</div>
            <div style={{ fontSize: 34, fontWeight: 750, color: "#fff", letterSpacing: -0.5 }}>{CR(state.totals[scenario])}</div>
            <div style={{ fontSize: 13, color: "#B9C4DE", marginTop: 6 }}>Combining all {state.deptProjections.length} departments and sectors</div>
          </div>
          <button style={{ background: "#fff", color: "#1A2233", border: "none", borderRadius: 10, padding: "12px 20px", fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}><FileDown size={16} /> Export Full Budget</button>
        </div>
        <div style={{ marginTop: 18, maxWidth: 420 }}><ScenarioRow scenarios={state.totals} chosen={scenario} onChoose={setScenario} /></div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16 }}>
        <Card>
          <SectionLabel>Share by Sector</SectionLabel>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart><Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} innerRadius={50} paddingAngle={2}>{pieData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Pie><Tooltip formatter={(v) => `₹${v} Cr`} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11.5 }} /></PieChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionLabel>Sector-Wise Breakdown</SectionLabel>
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {[...state.deptProjections].sort((a, b) => b.totals[scenario] - a.totals[scenario]).map((dp) => (
              <div key={dp.dept.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid #F0F1F4" }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: dp.dept.color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{dp.dept.sector}</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{CR(dp.totals[scenario])}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function BudgetBuilder() {
  const ds = useDataSource();
  const [mode, setMode] = useState("department");
  const [deptId, setDeptId] = useState(ds.departments[0]?.id);
  const [overrides, setOverrides] = useState({});
  const dept = ds.departments.find((d) => d.id === deptId);
  const projection = useMemo(() => (dept ? projectDepartmentBudget(ds, deptId) : null), [ds, dept, deptId]);
  const stateProjection = useMemo(() => projectFullStateBudget(ds), [ds]);
  if (!dept) return <Card>No departments found in this dataset.</Card>;
  const chosenDeptTotal = projection.lines.reduce((sum, l) => sum + l[overrides[l.scheme.id] || "realistic"], 0);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 6, background: "#EDEEF2", padding: 4, borderRadius: 11, width: "fit-content", marginBottom: 20 }}>
        {[{ id: "department", label: "Sectoral Budget" }, { id: "state", label: "Complete State Budget" }].map((t) => (
          <button key={t.id} onClick={() => setMode(t.id)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: mode === t.id ? "#fff" : "transparent", color: mode === t.id ? INK : MUTE, boxShadow: mode === t.id ? "0 1px 3px rgba(20,25,40,0.1)" : "none" }}>{t.label}</button>
        ))}
      </div>
      {mode === "department" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <select value={deptId} onChange={(e) => { setDeptId(e.target.value); setOverrides({}); }} style={selectStyle}>{ds.departments.map((d) => <option key={d.id} value={d.id}>{d.sector}</option>)}</select>
            <div style={{ fontSize: 13, color: MUTE }}>Building the proposal for <strong style={{ color: INK }}>{dept.sector}</strong></div>
          </div>
          <Card padding={0} style={{ marginBottom: 16, overflow: "hidden" }}>
            {projection.lines.map((l, i) => {
              const chosen = overrides[l.scheme.id] || "realistic";
              return (
                <div key={l.scheme.id} style={{ padding: "16px 20px", borderBottom: i < projection.lines.length - 1 ? "1px solid #F0F1F4" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                    <div><div style={{ fontWeight: 700, fontSize: 14 }}>{l.scheme.name}</div><div style={{ fontSize: 12, color: MUTE }}>{l.scheme.category}{l.method === "unit-cost" ? ` · ${l.units} ${l.unitLabel} planned` : " · based on recent trend"}</div></div>
                    <div style={{ fontSize: 18, fontWeight: 750 }}>{CR(l[chosen])}</div>
                  </div>
                  <ScenarioRow scenarios={{ conservative: l.conservative, realistic: l.realistic, ambitious: l.ambitious }} chosen={chosen} onChoose={(s) => setOverrides((p) => ({ ...p, [l.scheme.id]: s }))} />
                </div>
              );
            })}
          </Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: INK, color: "#fff", borderRadius: 16, padding: "20px 26px" }}>
            <div><div style={{ fontSize: 12, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>{dept.sector} Total</div><div style={{ fontSize: 27, fontWeight: 750 }}>{CR(Math.round(chosenDeptTotal * 10) / 10)}</div></div>
            <button style={{ background: "#fff", color: INK, border: "none", borderRadius: 10, padding: "12px 20px", fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}><FileDown size={16} /> Export Proposal</button>
          </div>
        </>
      )}
      {mode === "state" && (
        <>
          <Card padding={0} style={{ marginBottom: 16, overflow: "hidden" }}>
            {stateProjection.deptProjections.map((dp, i) => (
              <div key={dp.dept.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", borderBottom: i < stateProjection.deptProjections.length - 1 ? "1px solid #F0F1F4" : "none" }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: dp.dept.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{dp.dept.sector}</div><div style={{ fontSize: 12, color: MUTE }}>{dp.lines.length} schemes</div></div>
                <div style={{ fontSize: 17, fontWeight: 750 }}>{CR(dp.totals.realistic)}</div>
              </div>
            ))}
          </Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "linear-gradient(135deg, #1A2233, #2B3B5C)", color: "#fff", borderRadius: 16, padding: "22px 26px" }}>
            <div><div style={{ fontSize: 12, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Complete State Budget (Realistic)</div><div style={{ fontSize: 30, fontWeight: 750 }}>{CR(stateProjection.totals.realistic)}</div></div>
            <button style={{ background: "#fff", color: INK, border: "none", borderRadius: 10, padding: "13px 22px", fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}><FileDown size={16} /> Export Full Budget</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [ds, setDs] = useState(buildDemoDataSource());
  const [uploadedFileName, setUploadedFileName] = useState(null);

  const tabs = [
    { id: "home", label: "Overview", icon: Map },
    { id: "secretary", label: "Department Planning", icon: Building2 },
    { id: "ministry", label: "State & Sectors", icon: Landmark },
    { id: "builder", label: "Budget Builder", icon: LayoutGrid },
    { id: "upload", label: "Upload Data", icon: UploadCloud },
  ];

  function handleDataReady(newDs, fileName) {
    setDs(newDs);
    setUploadedFileName(fileName);
    setTab("home");
  }
  function resetToDemo() {
    setDs(buildDemoDataSource());
    setUploadedFileName(null);
  }

  return (
    <DataSourceContext.Provider value={ds}>
      <div className="app-shell" style={{ minHeight: "100vh", background: BG, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
        <style>{`
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
          .pulse { animation: pulse 1.1s ease-in-out infinite; }
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { height: 6px; width: 6px; }
          ::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }
          select:focus, input:focus { outline: none; border-color: #2E5FB5 !important; }
        `}</style>

        <div style={{ background: "#fff", borderBottom: `1px solid ${CARD_BORDER}`, position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #1A2233, #2E5FB5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 750, fontSize: 15 }}>R</div>
                <div>
                  <div style={{ fontWeight: 750, fontSize: 15.5, color: INK }}>Rajasthan Budget Intelligence</div>
                  <div style={{ fontSize: 11.5, color: MUTE }}>RITI &middot; Viksit Rajasthan @ 2047</div>
                </div>
              </div>
              {ds.isUploaded && (
                <button onClick={resetToDemo} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "#7A4EA8", background: "#F1EBF7", border: "none", padding: "8px 14px", borderRadius: 999, cursor: "pointer" }}>
                  <RefreshCcw size={13} /> Using {uploadedFileName || "uploaded data"} &middot; reset to demo
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
              {tabs.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 10, border: "none", background: tab === t.id ? INK : "transparent", color: tab === t.id ? "#fff" : "#555", fontSize: 13.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  <t.icon size={15} /> {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="app-content" style={{ padding: "28px 24px 60px" }}>
          {tab === "home" && <HomeView goTo={setTab} />}
          {tab === "secretary" && <SecretaryView />}
          {tab === "ministry" && <MinistryView />}
          {tab === "builder" && <BudgetBuilder />}
          {tab === "upload" && <UploadView onDataReady={handleDataReady} />}
        </div>
      </div>
    </DataSourceContext.Provider>
  );
}
