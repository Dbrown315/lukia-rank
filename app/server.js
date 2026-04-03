const express = require("express");
const session = require("express-session");
const { pool, migrate } = require("./db");

const app = express();
const port = Number(process.env.PORT || 3000);
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required");
}

const sortConfig = {
  best: {
    label: "Best",
    orderBy:
      "average_rating DESC NULLS LAST, rating_count DESC, l.created_at DESC, l.id DESC",
  },
  worst: {
    label: "Worst",
    orderBy:
      "average_rating ASC NULLS LAST, rating_count ASC, l.created_at DESC, l.id DESC",
  },
  recent: {
    label: "Recent",
    orderBy: "l.created_at DESC, l.id DESC",
  },
  oldest: {
    label: "Oldest",
    orderBy: "l.created_at ASC, l.id ASC",
  },
};

app.set("view engine", "ejs");
app.set("views", `${__dirname}/views`);

app.use(express.urlencoded({ extended: false }));
app.use(express.static(`${__dirname}/public`));
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function normalizeDisplayName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function normalizePhrase(value) {
  const trimmed = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }
  if (/^lukia\b/i.test(trimmed)) {
    return trimmed;
  }
  return `Lukia ${trimmed}`;
}

async function getOrCreateUser(name) {
  const normalized = normalizeDisplayName(name);
  if (!normalized) {
    throw new Error("Please enter a display name.");
  }

  const existing = await pool.query("SELECT id, name FROM users WHERE lower(name) = lower($1)", [normalized]);
  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  const inserted = await pool.query(
    `
    INSERT INTO users (name)
    VALUES ($1)
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
    `,
    [normalized]
  );
  return inserted.rows[0];
}

async function loadAuthors() {
  const result = await pool.query(`
    SELECT id, name
    FROM users
    WHERE EXISTS (
      SELECT 1
      FROM lukias l
      WHERE l.author_id = users.id
    )
    ORDER BY lower(name) ASC
  `);

  return result.rows;
}

async function loadLukias(sortKey, currentUserId, authorId) {
  const selectedSort = sortConfig[sortKey] ? sortKey : "recent";
  const selectedAuthorId = Number.isInteger(authorId) && authorId > 0 ? authorId : null;
  const params = [currentUserId || 0];
  let whereClause = "";

  if (selectedAuthorId) {
    params.push(selectedAuthorId);
    whereClause = `WHERE l.author_id = $${params.length}`;
  }

  const query = `
    SELECT
      l.id,
      l.phrase,
      l.created_at,
      u.name AS author_name,
      ROUND(AVG(r.rating)::numeric, 2) AS average_rating,
      COUNT(r.id)::int AS rating_count,
      MAX(CASE WHEN r.user_id = $1 THEN r.rating END) AS user_rating
    FROM lukias l
    JOIN users u ON u.id = l.author_id
    LEFT JOIN ratings r ON r.lukia_id = l.id
    ${whereClause}
    GROUP BY l.id, u.name
    ORDER BY ${sortConfig[selectedSort].orderBy}
  `;

  const result = await pool.query(query, params);
  return {
    selectedSort,
    selectedAuthorId,
    lukias: result.rows,
  };
}

app.get("/", async (req, res) => {
  const sort = req.query.sort || "recent";
  const authorId = Number.parseInt(req.query.author, 10);
  const flashMessage = req.session.flashMessage || null;
  const flashError = req.session.flashError || null;
  delete req.session.flashMessage;
  delete req.session.flashError;

  const [authors, { selectedSort, selectedAuthorId, lukias }] = await Promise.all([
    loadAuthors(),
    loadLukias(sort, req.session.user?.id, authorId),
  ]);

  res.render("index", {
    appUrl,
    flashMessage,
    flashError,
    sortOptions: sortConfig,
    selectedSort,
    authors,
    selectedAuthorId,
    defaultCreatedAt: new Date().toISOString().slice(0, 10),
    lukias,
  });
});

app.post("/login", async (req, res) => {
  try {
    const user = await getOrCreateUser(req.body.name);
    req.session.user = user;
    req.session.flashMessage = `Logged in as ${user.name}`;
  } catch (error) {
    req.session.flashError = error.message;
  }

  res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.post("/lukias", async (req, res) => {
  if (!req.session.user) {
    req.session.flashError = "Pick a name before posting a Lukia.";
    res.redirect("/");
    return;
  }

  const phrase = normalizePhrase(req.body.phrase);
  const createdAtValue = String(req.body.created_at || "").trim();
  const createdAt = createdAtValue ? new Date(createdAtValue) : new Date();

  if (!phrase) {
    req.session.flashError = "Please enter a Lukia phrase.";
    res.redirect("/");
    return;
  }

  if (Number.isNaN(createdAt.getTime())) {
    req.session.flashError = "Please enter a valid date.";
    res.redirect("/");
    return;
  }

  try {
    await pool.query(
      `
      INSERT INTO lukias (phrase, author_id, created_at)
      VALUES ($1, $2, $3)
      `,
      [phrase, req.session.user.id, createdAt]
    );
    req.session.flashMessage = `Posted ${phrase}`;
  } catch (error) {
    if (error.code === "23505") {
      req.session.flashError = "That Lukia already exists.";
    } else {
      req.session.flashError = "Could not save that Lukia.";
    }
  }

  res.redirect("/");
});

app.post("/ratings", async (req, res) => {
  if (!req.session.user) {
    req.session.flashError = "Pick a name before rating Lukias.";
    res.redirect("/");
    return;
  }

  const lukiaId = Number(req.body.lukia_id);
  const rating = Number(req.body.rating);
  const sort = req.body.sort || "recent";
  const author = req.body.author || "";

  if (!Number.isInteger(lukiaId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    req.session.flashError = "Ratings must be between 1 and 5.";
    res.redirect(`/?sort=${encodeURIComponent(sort)}&author=${encodeURIComponent(author)}`);
    return;
  }

  await pool.query(
    `
    INSERT INTO ratings (lukia_id, user_id, rating)
    VALUES ($1, $2, $3)
    ON CONFLICT (lukia_id, user_id)
    DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()
    `,
    [lukiaId, req.session.user.id, rating]
  );

  req.session.flashMessage = "Rating saved.";
  res.redirect(`/?sort=${encodeURIComponent(sort)}&author=${encodeURIComponent(author)}`);
});

app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send("Something went wrong.");
});

async function start() {
  await migrate();
  app.listen(port, "0.0.0.0", () => {
    console.log(`Lukia Rank listening on ${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
