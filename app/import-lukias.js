const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { pool, migrate } = require("./db");

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findColumn(row, aliases) {
  const entries = Object.entries(row);
  for (const [key, value] of entries) {
    if (aliases.includes(normalizeKey(key))) {
      return value;
    }
  }
  return undefined;
}

function normalizePhrase(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }
  if (/^lukia\b/i.test(value)) {
    return value;
  }
  return `Lukia ${value}`;
}

function parseDate(rawValue) {
  if (!rawValue) {
    return new Date();
  }
  if (rawValue instanceof Date) {
    return rawValue;
  }
  if (typeof rawValue === "number") {
    const parsed = XLSX.SSF.parse_date_code(rawValue);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
    }
  }
  const parsedDate = new Date(rawValue);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate;
  }
  return new Date();
}

async function getOrCreateUser(name) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error("Missing author name");
  }

  const existing = await pool.query("SELECT id FROM users WHERE lower(name) = lower($1)", [normalized]);
  if (existing.rowCount > 0) {
    return existing.rows[0].id;
  }

  const inserted = await pool.query(
    "INSERT INTO users (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
    [normalized]
  );
  return inserted.rows[0].id;
}

async function importWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Workbook does not contain any sheets");
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  let imported = 0;

  for (const row of rows) {
    const phraseRaw = findColumn(row, [
      "lukia",
      "name",
      "lukianame",
      "lukiaphrase",
      "phrase",
      "title",
    ]);
    const authorRaw = findColumn(row, [
      "author",
      "person",
      "nameofperson",
      "madeby",
      "creator",
      "who",
    ]);
    const dateRaw = findColumn(row, [
      "date",
      "created",
      "createdat",
      "datecreated",
      "posted",
      "day",
    ]);

    const phrase = normalizePhrase(phraseRaw);
    const author = String(authorRaw || "").trim();

    if (!phrase || !author) {
      continue;
    }

    const authorId = await getOrCreateUser(author);
    const createdAt = parseDate(dateRaw);

    const insertResult = await pool.query(
      `
      INSERT INTO lukias (phrase, author_id, created_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (phrase) DO NOTHING
      `,
      [phrase, authorId, createdAt]
    );

    imported += insertResult.rowCount;
  }

  return imported;
}

async function main() {
  const importDir = process.env.IMPORT_DIR || "/imports";
  const inputArg = process.argv[2];
  const filePath = inputArg ? path.resolve(inputArg) : null;

  if (!filePath) {
    const files = fs
      .readdirSync(importDir)
      .filter((file) => /\.(xlsx|xls|csv)$/i.test(file))
      .sort();

    if (files.length === 0) {
      throw new Error(`No spreadsheet files found in ${importDir}`);
    }

    files[0] = path.join(importDir, files[0]);
    const imported = await runImport(files[0]);
    console.log(`Imported ${imported} rows from ${files[0]}`);
    return;
  }

  const imported = await runImport(filePath);
  console.log(`Imported ${imported} rows from ${filePath}`);
}

async function runImport(filePath) {
  await migrate();
  return importWorkbook(filePath);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
