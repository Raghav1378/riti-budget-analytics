import http from "node:http";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { PDFParse } from "pdf-parse";

dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

const port = Number(process.env.PORT || process.env.API_PORT || 8787);
const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const apiKey = process.env.GEMINI_API_KEY;
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const frontendDirectory = path.resolve(import.meta.dirname, "dist");
const dataDirectory = path.resolve(process.env.DATA_DIR || path.resolve(import.meta.dirname, "..", "data"));
const stopWords = new Set("the and for with from this that what were was are how much about into over under per year years department budget actual total scheme state latest show tell give does did has have its their your");

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !stopWords.has(token)) || [];
}

function chunkText(text, size = 1800, overlap = 250) {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    const chunk = clean.slice(start, start + size).trim();
    if (chunk.length > 80) chunks.push(chunk);
    if (start + size >= clean.length) break;
  }
  return chunks;
}

async function buildSharedIndex() {
  const files = (await readdir(dataDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && [".pdf", ".txt", ".md"].includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name);
  const chunks = [];
  for (const fileName of files) {
    try {
      const filePath = path.join(dataDirectory, fileName);
      const extension = path.extname(fileName).toLowerCase();
      const text = extension === ".pdf"
        ? await (async () => {
          const parser = new PDFParse({ data: await readFile(filePath) });
          try { return (await parser.getText()).text; } finally { await parser.destroy(); }
        })()
        : await readFile(filePath, "utf-8");
      chunkText(text).forEach((chunkTextValue, index) => chunks.push({ fileName, index: index + 1, text: chunkTextValue, terms: new Set(tokenize(chunkTextValue)) }));
    } catch (error) {
      console.error(`Could not index ${fileName}: ${error.message}`);
    }
  }
  console.log(`Indexed ${chunks.length} source passages from ${files.length} files in ${dataDirectory}`);
  return chunks;
}

const sharedIndexPromise = buildSharedIndex();

function retrieveSharedContext(chunks, question, scopeLabel) {
  const queryTerms = new Set(tokenize(`${question} ${scopeLabel || ""}`));
  return chunks
    .map((chunk) => {
      const matches = [...queryTerms].filter((term) => chunk.terms.has(term)).length;
      const phraseBoost = chunk.text.toLowerCase().includes(String(scopeLabel || "").toLowerCase()) ? 3 : 0;
      return { ...chunk, score: matches + phraseBoost };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": allowedOrigin });
  res.end(JSON.stringify(body));
}

function startEventStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": allowedOrigin,
  });
}

function sendEvent(res, type, payload = {}) {
  res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

async function serveFrontend(req, res) {
  const requestedPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
  const filePath = path.resolve(frontendDirectory, relativePath);
  if (!filePath.startsWith(frontendDirectory)) return false;
  try {
    const content = await readFile(filePath);
    const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
    return true;
  } catch {
    if (requestedPath !== "/") {
      try {
        const content = await readFile(path.join(frontendDirectory, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
        return true;
      } catch { return false; }
    }
    return false;
  }
}

function buildPrompt({ question, dataSummary, computedAnswer, sharedContext, scopeLabel }) {
  return `You are a budget assistant inside an Indian state government planning tool. Answer the user's question clearly and naturally in under 140 words.

Answering rules:
- The computed result is the primary authority for department figures, calculations, totals, trends, and utilization. Do not override it with PDF text.
- Use the shared PDF context for policy, definitions, budget-head explanations, or details not present in the computed result.
- If the question is scoped to ${scopeLabel || "the current department"}, stay focused on that scope unless the user explicitly asks for a state-wide comparison.
- Use the computed result and computed facts as authoritative. When they contain a calculated estimate, explain that estimate clearly; do not replace it with a PDF figure.
- Explain the answer naturally and mention the relevant department, scheme, document, or year when available. Do not mention prompts or implementation details.

Relevant budget data:
${dataSummary}

Computed result:
${computedAnswer}

Shared PDF context:
${sharedContext || "No matching PDF passage was found."}

User question: ${question}`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/api/status") {
    const sharedChunks = await sharedIndexPromise;
    sendJson(res, 200, { ok: true, pdfPassages: sharedChunks.length, dataDirectory });
    return;
  }
  if (req.method === "GET" && !req.url.startsWith("/api/") && await serveFrontend(req, res)) return;
  const isStreamRequest = req.method === "POST" && req.url === "/api/ask/stream";
  if (req.method !== "POST" || (req.url !== "/api/ask" && !isStreamRequest)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const sharedChunks = await sharedIndexPromise;
    const matches = retrieveSharedContext(sharedChunks, input.question, input.scopeLabel);
    const sharedContext = matches.map((match) => `[${match.fileName}, passage ${match.index}] ${match.text}`).join("\n\n");
    const sources = matches.map(({ fileName, index, text: sourceText }) => ({ fileName, index, text: sourceText }));
    if (!apiKey) {
      const text = input.computedAnswer || (matches.length
        ? "Relevant source passages were retrieved, but no computed budget answer was supplied."
        : "No computed budget answer or matching source passage was supplied.");
      if (isStreamRequest) {
        startEventStream(res);
        sendEvent(res, "token", { text });
        sendEvent(res, "done", { sources, grounded: true });
        res.end();
        return;
      }
      sendJson(res, 200, { text, sources: matches.map(({ fileName, index, text: sourceText }) => ({ fileName, index, text: sourceText })), grounded: true });
      return;
    }
    const upstreamEndpoint = isStreamRequest
      ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const upstream = await fetch(upstreamEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ contents: [{ parts: [{ text: buildPrompt({ ...input, sharedContext }) }] }] }),
    });
    if (!upstream.ok) {
      const data = await upstream.json().catch(() => ({}));
      if (isStreamRequest) {
        startEventStream(res);
        sendEvent(res, "error", { error: data?.error?.message || "Gemini request failed." });
        res.end();
        return;
      }
      sendJson(res, upstream.status, { error: data?.error?.message || "Gemini request failed." });
      return;
    }
    if (isStreamRequest) {
      startEventStream(res);
      const reader = upstream.body?.getReader();
      if (!reader) throw new Error("Gemini returned no stream.");
      const decoder = new TextDecoder();
      let buffer = "";
      const processEvents = (eventText) => {
        for (const event of eventText.split("\n\n")) {
          const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const chunk = JSON.parse(dataLine.slice(6));
          const text = chunk?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
          if (text) sendEvent(res, "token", { text });
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        buffer = buffer.replace(/\r\n/g, "\n");
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        processEvents(events.join("\n\n"));
        if (done) break;
      }
      processEvents(buffer);
      sendEvent(res, "done", { sources, grounded: true });
      res.end();
      return;
    }
    const data = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) { sendJson(res, 502, { error: "Gemini returned no answer." }); return; }
    sendJson(res, 200, { text, sources, grounded: true });
  } catch (error) {
    if (isStreamRequest) {
      if (!res.headersSent) startEventStream(res);
      sendEvent(res, "error", { error: error.message || "Streaming request failed." });
      res.end();
      return;
    }
    sendJson(res, 400, { error: error.message || "Invalid request." });
  }
});

server.listen(port, () => console.log(`Budget API listening on http://localhost:${port}`));