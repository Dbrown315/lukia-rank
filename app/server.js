const express = require("express");
const session = require("express-session");
const { pool, migrate } = require("./db");

const app = express();
const port = Number(process.env.PORT || 3000);
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const sessionSecret = process.env.SESSION_SECRET;
// Session cookies need different secure behavior when the app sits behind HTTPS later.
const appUrlProtocol = (() => {
  try {
    return new URL(appUrl).protocol;
  } catch {
    return "http:";
  }
})();

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
  unrated: {
    label: "Unrated By Me",
    orderBy: "l.created_at DESC, l.id DESC",
  },
};

const ageConfig = {
  week: {
    label: "Week",
    interval: "7 days",
  },
  month: {
    label: "Month",
    interval: "1 month",
  },
  sixMonths: {
    label: "6 Months",
    interval: "6 months",
  },
  year: {
    label: "Year",
    interval: "1 year",
  },
  all: {
    label: "All Time",
    interval: null,
  },
};

app.set("view engine", "ejs");
app.set("views", `${__dirname}/views`);
app.set("trust proxy", 1);

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
      secure: appUrlProtocol === "https:" ? "auto" : false,
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

async function loadLukias(sortKey, currentUserId, authorId, ageKey) {
  const selectedSort = sortConfig[sortKey] ? sortKey : "recent";
  const selectedAuthorId = Number.isInteger(authorId) && authorId > 0 ? authorId : null;
  const selectedAge = ageConfig[ageKey] ? ageKey : "all";
  const params = [currentUserId || 0];
  const whereParts = [];

  // "Unrated By Me" is computed per logged-in user rather than from the global rating average.
  if (selectedSort === "unrated") {
    if (currentUserId) {
      whereParts.push(`NOT EXISTS (
        SELECT 1
        FROM ratings r_self
        WHERE r_self.lukia_id = l.id AND r_self.user_id = $1
      )`);
    } else {
      whereParts.push("1 = 0");
    }
  }

  if (selectedAuthorId) {
    params.push(selectedAuthorId);
    whereParts.push(`l.author_id = $${params.length}`);
  }

  if (selectedAge !== "all") {
    params.push(ageConfig[selectedAge].interval);
    whereParts.push(`l.created_at >= NOW() - $${params.length}::interval`);
  }

  // Build the WHERE clause incrementally so sort, author, and age filters can combine freely.
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const query = `
    SELECT
      l.id,
      l.phrase,
      l.author_id,
      l.created_at,
      u.name AS author_name,
      ROUND(AVG(r.rating)::numeric, 2) AS average_rating,
      COUNT(r.id)::int AS rating_count,
      MAX(CASE WHEN r.user_id = $1 THEN r.rating END) AS user_rating
    FROM lukias l
    JOIN users u ON u.id = l.author_id
    LEFT JOIN ratings r ON r.lukia_id = l.id
    ${whereClause}
    GROUP BY l.id, l.author_id, u.name
    ORDER BY ${sortConfig[selectedSort].orderBy}
  `;

  const result = await pool.query(query, params);
  return {
    selectedSort,
    selectedAuthorId,
    selectedAge,
    lukias: result.rows,
  };
}

async function findExistingLukia(phrase) {
  const result = await pool.query(
    `
    SELECT id, phrase
    FROM lukias
    WHERE lower(phrase) = lower($1)
    LIMIT 1
    `,
    [phrase]
  );

  return result.rows[0] || null;
}

async function buildLukiaSectionData(sort, currentUser, authorId, age) {
  // The list section is rendered both for full page loads and for AJAX refreshes.
  const [authors, { selectedSort, selectedAuthorId, selectedAge, lukias }] = await Promise.all([
    loadAuthors(),
    loadLukias(sort, currentUser?.id, authorId, age),
  ]);

  return {
    appUrl,
    currentUser: currentUser || null,
    sortOptions: sortConfig,
    ageOptions: ageConfig,
    selectedSort,
    authors,
    selectedAuthorId,
    selectedAge,
    defaultCreatedAt: new Date().toISOString().slice(0, 10),
    lukias,
  };
}

async function getLukiaRatingSummary(lukiaId, currentUserId) {
  const result = await pool.query(
    `
    SELECT
      ROUND(AVG(r.rating)::numeric, 2) AS average_rating,
      COUNT(r.id)::int AS rating_count,
      MAX(CASE WHEN r.user_id = $2 THEN r.rating END) AS user_rating
    FROM lukias l
    LEFT JOIN ratings r ON r.lukia_id = l.id
    WHERE l.id = $1
    GROUP BY l.id
    `,
    [lukiaId, currentUserId || 0]
  );

  return result.rows[0] || {
    average_rating: null,
    rating_count: 0,
    user_rating: null,
  };
}

function renderView(viewName, data) {
  // EJS rendering is callback-based; wrap it so route handlers can stay async/await.
  return new Promise((resolve, reject) => {
    app.render(viewName, data, (error, html) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(html);
    });
  });
}

app.get("/", async (req, res) => {
  const sort = req.query.sort || "recent";
  const authorId = Number.parseInt(req.query.author, 10);
  const age = req.query.age || "all";
  const partial = req.query.partial;
  const flashMessage = req.session.flashMessage || null;
  const flashError = req.session.flashError || null;
  delete req.session.flashMessage;
  delete req.session.flashError;

  const viewModel = {
    appUrl,
    flashMessage,
    flashError,
    ...(await buildLukiaSectionData(sort, req.session.user || null, authorId, age)),
  };

  // The frontend can ask for only the list section to avoid a full page reload.
  if (partial === "lukias") {
    res.render("_lukia-list", viewModel);
    return;
  }

  res.render("index", viewModel);
});

app.post("/login", async (req, res) => {
  const wantsJson =
    req.get("x-requested-with") === "fetch" ||
    req.accepts(["html", "json"]) === "json";

  try {
    const user = await getOrCreateUser(req.body.name);
    req.session.user = user;

    if (wantsJson) {
      res.json({
        ok: true,
        message: `Logged in as ${user.name}`,
        user,
      });
      return;
    }

    req.session.flashMessage = `Logged in as ${user.name}`;
  } catch (error) {
    if (wantsJson) {
      res.status(400).json({
        ok: false,
        error: error.message,
      });
      return;
    }

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
  const wantsJson =
    req.get("x-requested-with") === "fetch" ||
    req.accepts(["html", "json"]) === "json";

  if (!req.session.user) {
    if (wantsJson) {
      res.status(401).json({ ok: false, error: "Pick a name before posting a Lukia." });
      return;
    }

    req.session.flashError = "Pick a name before posting a Lukia.";
    res.redirect("/");
    return;
  }

  const phrase = normalizePhrase(req.body.phrase);
  const createdAtValue = String(req.body.created_at || "").trim();
  const createdAt = createdAtValue ? new Date(createdAtValue) : new Date();

  if (!phrase) {
    if (wantsJson) {
      res.status(400).json({ ok: false, error: "Please enter a Lukia phrase." });
      return;
    }

    req.session.flashError = "Please enter a Lukia phrase.";
    res.redirect("/");
    return;
  }

  if (Number.isNaN(createdAt.getTime())) {
    if (wantsJson) {
      res.status(400).json({ ok: false, error: "Please enter a valid date." });
      return;
    }

    req.session.flashError = "Please enter a valid date.";
    res.redirect("/");
    return;
  }

  try {
    const existing = await findExistingLukia(phrase);
    // Use the same normalized phrase check as the UI warning so server and client agree.
    if (existing) {
      if (wantsJson) {
        res.status(409).json({ ok: false, error: `That Lukia already exists as ${existing.phrase}.` });
        return;
      }

      req.session.flashError = "That Lukia already exists.";
      res.redirect("/");
      return;
    }

    await pool.query(
      `
      INSERT INTO lukias (phrase, author_id, created_at)
      VALUES ($1, $2, $3)
      `,
      [phrase, req.session.user.id, createdAt]
    );

    if (wantsJson) {
      const authorId = Number.parseInt(req.body.author, 10);
      // Return a freshly rendered list section so the browser can swap it in-place.
      const html = await renderView(
        "_lukia-list",
        await buildLukiaSectionData(
          req.body.sort || "recent",
          req.session.user,
          authorId,
          req.body.age || "all"
        )
      );

      res.json({
        ok: true,
        message: `Posted ${phrase}`,
        html,
      });
      return;
    }

    req.session.flashMessage = `Posted ${phrase}`;
  } catch (error) {
    if (error.code === "23505") {
      if (wantsJson) {
        res.status(409).json({ ok: false, error: "That Lukia already exists." });
        return;
      }

      req.session.flashError = "That Lukia already exists.";
    } else {
      if (wantsJson) {
        res.status(500).json({ ok: false, error: "Could not save that Lukia." });
        return;
      }

      req.session.flashError = "Could not save that Lukia.";
    }
  }

  res.redirect("/");
});

app.post("/ratings", async (req, res) => {
  const wantsJson =
    req.get("x-requested-with") === "fetch" ||
    req.accepts(["html", "json"]) === "json";

  if (!req.session.user) {
    if (wantsJson) {
      res.status(401).json({ ok: false, error: "Pick a name before rating Lukias." });
      return;
    }

    req.session.flashError = "Pick a name before rating Lukias.";
    res.redirect("/");
    return;
  }

  const lukiaId = Number(req.body.lukia_id);
  const rating = Number(req.body.rating);
  const sort = req.body.sort || "recent";
  const author = req.body.author || "";
  const age = req.body.age || "all";

  if (!Number.isInteger(lukiaId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    if (wantsJson) {
      res.status(400).json({ ok: false, error: "Ratings must be between 1 and 5." });
      return;
    }

    req.session.flashError = "Ratings must be between 1 and 5.";
    res.redirect(`/?sort=${encodeURIComponent(sort)}&author=${encodeURIComponent(author)}&age=${encodeURIComponent(age)}`);
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

  const summary = await getLukiaRatingSummary(lukiaId, req.session.user.id);

  if (wantsJson) {
    res.json({
      ok: true,
      message: "Rating saved.",
      summary,
    });
    return;
  }

  req.session.flashMessage = "Rating saved.";
  res.redirect(`/?sort=${encodeURIComponent(sort)}&author=${encodeURIComponent(author)}&age=${encodeURIComponent(age)}`);
});

app.get("/lukias/check", async (req, res) => {
  const phrase = normalizePhrase(req.query.phrase);

  // This powers the inline duplicate warning while the user types.
  if (!phrase) {
    res.json({ ok: true, exists: false });
    return;
  }

  const existing = await findExistingLukia(phrase);
  res.json({
    ok: true,
    exists: Boolean(existing),
    normalizedPhrase: phrase,
    existingPhrase: existing?.phrase || null,
  });
});

app.post("/lukias/:id/delete", async (req, res) => {
  const wantsJson =
    req.get("x-requested-with") === "fetch" ||
    req.accepts(["html", "json"]) === "json";

  if (!req.session.user) {
    if (wantsJson) {
      res.status(401).json({ ok: false, error: "Pick a name before deleting Lukias." });
      return;
    }

    req.session.flashError = "Pick a name before deleting Lukias.";
    res.redirect("/");
    return;
  }

  const lukiaId = Number(req.params.id);
  const sort = req.body.sort || "recent";
  const authorId = Number.parseInt(req.body.author, 10);
  const age = req.body.age || "all";

  if (!Number.isInteger(lukiaId) || lukiaId <= 0) {
    if (wantsJson) {
      res.status(400).json({ ok: false, error: "Invalid Lukia." });
      return;
    }

    req.session.flashError = "Invalid Lukia.";
    res.redirect("/");
    return;
  }

  const existing = await pool.query(
    "SELECT id, phrase, author_id FROM lukias WHERE id = $1",
    [lukiaId]
  );

  if (existing.rowCount === 0) {
    if (wantsJson) {
      res.status(404).json({ ok: false, error: "That Lukia no longer exists." });
      return;
    }

    req.session.flashError = "That Lukia no longer exists.";
    res.redirect("/");
    return;
  }

  const lukia = existing.rows[0];
  // Keep deletion ownership simple: only the original poster can remove the entry.
  if (lukia.author_id !== req.session.user.id) {
    if (wantsJson) {
      res.status(403).json({ ok: false, error: "Only the person who posted this Lukia can delete it." });
      return;
    }

    req.session.flashError = "Only the person who posted this Lukia can delete it.";
    res.redirect("/");
    return;
  }

  await pool.query("DELETE FROM lukias WHERE id = $1", [lukiaId]);

  if (wantsJson) {
    const html = await renderView(
      "_lukia-list",
      await buildLukiaSectionData(sort, req.session.user, authorId, age)
    );

    res.json({
      ok: true,
      message: `Deleted ${lukia.phrase}`,
      html,
    });
    return;
  }

  req.session.flashMessage = `Deleted ${lukia.phrase}`;
  res.redirect(`/?sort=${encodeURIComponent(sort)}&author=${encodeURIComponent(req.body.author || "")}&age=${encodeURIComponent(age)}`);
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
