function toFormBody(form) {
  return new URLSearchParams(new FormData(form)).toString();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function setStatus(element, message, state) {
  if (!element) {
    return;
  }

  element.textContent = message || "";
  if (state) {
    element.dataset.state = state;
  } else {
    delete element.dataset.state;
  }
}

let phraseCheckTimer = null;

async function refreshLukiaSection(searchParams, statusMessage) {
  const url = new URL(window.location.href);
  url.search = searchParams.toString();
  url.searchParams.set("partial", "lukias");

  const response = await fetch(url, {
    headers: {
      "X-Requested-With": "fetch",
    },
  });

  if (!response.ok) {
    throw new Error("Could not refresh Lukias.");
  }

  const html = await response.text();
  const currentSection = document.querySelector("#lukia-section");

  if (!currentSection) {
    throw new Error("Could not find Lukia list.");
  }

  currentSection.outerHTML = html;

  const newParams = new URLSearchParams(searchParams);
  updateHistory(newParams);

  bindDynamicHandlers();
  syncSortControlsWithUrl();

  if (statusMessage) {
    setStatus(document.querySelector(".sort-status"), statusMessage, "success");
  }
}

function updateHistory(searchParams) {
  const nextUrl = new URL(window.location.href);
  nextUrl.search = searchParams.toString();
  window.history.replaceState({}, "", nextUrl);
}

function syncSortControlsWithUrl() {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get("sort") || "recent";
  const author = params.get("author") || "";
  const age = params.get("age") || "all";
  const sortSelect = document.querySelector("#sort");
  const authorSelect = document.querySelector("#author");
  const ageSelect = document.querySelector("#age");

  if (sortSelect) {
    sortSelect.value = sort;
  }

  if (authorSelect) {
    authorSelect.value = author;
  }

  if (ageSelect) {
    ageSelect.value = age;
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const loginForm = event.currentTarget;
  const loginPanel = document.querySelector("#login-panel");
  const loginStatus = loginPanel?.querySelector(".login-status");
  const button = loginForm.querySelector("button[type='submit']");

  setStatus(loginStatus, "Logging in...", "pending");
  if (button) {
    button.disabled = true;
  }

  try {
    const payload = await fetchJson(loginForm.action, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "fetch",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: toFormBody(loginForm),
    });

    if (loginPanel) {
      loginPanel.innerHTML = `
        <h2>Name Login</h2>
        <p class="login-copy">You are posting as <strong>${payload.user.name}</strong>.</p>
        <form method="post" action="/logout">
          <button type="submit" class="ghost">Switch name</button>
        </form>
        <p class="login-status" data-state="success" aria-live="polite">${payload.message}</p>
      `;
    }

    const params = new URLSearchParams(window.location.search);
    await refreshLukiaSection(params, "Updated for your login.");
  } catch (error) {
    setStatus(loginStatus, error.message, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function handlePostSubmit(event) {
  event.preventDefault();

  const postForm = event.currentTarget;
  const postStatus = document.querySelector(".post-status");
  const phraseStatus = document.querySelector(".phrase-status");
  const button = postForm.querySelector("button[type='submit']");
  const currentSort = document.querySelector("#sort")?.value || "recent";
  const currentAuthor = document.querySelector("#author")?.value || "";
  const currentAge = document.querySelector("#age")?.value || "all";

  setStatus(postStatus, "Posting...", "pending");
  setStatus(phraseStatus, "", null);
  if (button) {
    button.disabled = true;
  }

  try {
    const body = new URLSearchParams(new FormData(postForm));
    body.set("sort", currentSort);
    body.set("author", currentAuthor);
    body.set("age", currentAge);

    const payload = await fetchJson(postForm.action, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "fetch",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    });

    const currentSection = document.querySelector("#lukia-section");
    if (currentSection) {
      currentSection.outerHTML = payload.html;
    }

    const params = new URLSearchParams();
    params.set("sort", currentSort);
    if (currentAuthor) {
      params.set("author", currentAuthor);
    }
    if (currentAge && currentAge !== "all") {
      params.set("age", currentAge);
    }
    updateHistory(params);
    bindDynamicHandlers();
    syncSortControlsWithUrl();

    postForm.reset();
    const dateInput = document.querySelector("#created_at");
    if (dateInput) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }

    setStatus(document.querySelector(".post-status"), payload.message, "success");
  } catch (error) {
    setStatus(postStatus, error.message, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function handleDeleteSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const status = form.querySelector(".delete-status");
  const button = form.querySelector("button[type='submit']");

  setStatus(status, "Deleting...", "pending");
  if (button) {
    button.disabled = true;
  }

  try {
    const payload = await fetchJson(form.action, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "fetch",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: toFormBody(form),
    });

    const currentSection = document.querySelector("#lukia-section");
    if (currentSection) {
      currentSection.outerHTML = payload.html;
    }

    const params = new URLSearchParams();
    const sort = form.querySelector('input[name="sort"]')?.value || "recent";
    const author = form.querySelector('input[name="author"]')?.value || "";
    const age = form.querySelector('input[name="age"]')?.value || "all";
    params.set("sort", sort);
    if (author) {
      params.set("author", author);
    }
    if (age && age !== "all") {
      params.set("age", age);
    }
    updateHistory(params);
    bindDynamicHandlers();
    syncSortControlsWithUrl();
    setStatus(document.querySelector(".sort-status"), payload.message, "success");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function checkDuplicatePhrase() {
  const phraseInput = document.querySelector("#phrase");
  const phraseStatus = document.querySelector(".phrase-status");
  const postButton = document.querySelector("#post-form button[type='submit']");

  if (!phraseInput) {
    return;
  }

  const rawPhrase = phraseInput.value.trim();
  if (!rawPhrase) {
    setStatus(phraseStatus, "", null);
    if (postButton) {
      postButton.disabled = false;
    }
    return;
  }

  try {
    const url = new URL("/lukias/check", window.location.origin);
    url.searchParams.set("phrase", rawPhrase);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "fetch",
      },
    });

    const payload = await response.json();

    if (payload.exists) {
      setStatus(
        phraseStatus,
        `Warning: this already exists as ${payload.existingPhrase}.`,
        "error"
      );
      if (postButton) {
        postButton.disabled = true;
      }
      return;
    }

    setStatus(phraseStatus, `Will post as ${payload.normalizedPhrase}.`, "success");
    if (postButton) {
      postButton.disabled = false;
    }
  } catch (_error) {
    setStatus(phraseStatus, "", null);
    if (postButton) {
      postButton.disabled = false;
    }
  }
}

async function handleRatingSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const status = form.querySelector(".rating-status");
  const summaryValue = form.closest(".lukia-card")?.querySelector("[data-rating-summary-value]");
  const summaryCount = form.closest(".lukia-card")?.querySelector("[data-rating-summary-count]");
  const ratedIndicator = form.closest(".lukia-card")?.querySelector(".rated-indicator");
  const button = form.querySelector("button[type='submit']");

  setStatus(status, "Saving...", "pending");
  if (button) {
    button.disabled = true;
  }

  try {
    const payload = await fetchJson(form.action, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "fetch",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: toFormBody(form),
    });

    if (summaryValue) {
      summaryValue.textContent =
        payload.summary.average_rating === null ? "Unrated" : `${payload.summary.average_rating} / 5`;
    }

    if (summaryCount) {
      const count = Number(payload.summary.rating_count) || 0;
      summaryCount.textContent = count > 0 ? `from ${count} rating${count === 1 ? "" : "s"}` : "";
    }

    if (ratedIndicator) {
      const userRating = Number(payload.summary.user_rating);
      ratedIndicator.innerHTML =
        Number.isInteger(userRating) && userRating > 0
          ? `You rated this <strong>${userRating}/5</strong>.`
          : "You have not rated this yet.";
    }

    setStatus(status, payload.message || "Rating saved.", "success");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function handleSortChange(event) {
  const form = event.currentTarget;
  const params = new URLSearchParams(new FormData(form));

  try {
    setStatus(document.querySelector(".sort-status"), "Updating...", "pending");
    await refreshLukiaSection(params, "Updated.");
  } catch (error) {
    setStatus(document.querySelector(".sort-status"), error.message, "error");
  }
}

function bindDynamicHandlers() {
  for (const form of document.querySelectorAll(".rating-form")) {
    if (form.dataset.bound === "true") {
      continue;
    }
    form.dataset.bound = "true";
    form.addEventListener("submit", handleRatingSubmit);
  }

  for (const form of document.querySelectorAll(".delete-form")) {
    if (form.dataset.bound === "true") {
      continue;
    }
    form.dataset.bound = "true";
    form.addEventListener("submit", handleDeleteSubmit);
  }

  const sortForm = document.querySelector("#sort-form");
  if (sortForm && sortForm.dataset.bound !== "true") {
    sortForm.dataset.bound = "true";
    sortForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleSortChange(event);
    });

    for (const select of sortForm.querySelectorAll("select")) {
      select.addEventListener("change", async () => {
        await handleSortChange({ currentTarget: sortForm });
      });
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  syncSortControlsWithUrl();

  const loginForm = document.querySelector("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLoginSubmit);
  }

  const postForm = document.querySelector("#post-form");
  if (postForm) {
    postForm.addEventListener("submit", handlePostSubmit);

    const phraseInput = document.querySelector("#phrase");
    if (phraseInput && phraseInput.dataset.bound !== "true") {
      phraseInput.dataset.bound = "true";
      phraseInput.addEventListener("input", () => {
        if (phraseCheckTimer) {
          window.clearTimeout(phraseCheckTimer);
        }

        phraseCheckTimer = window.setTimeout(() => {
          void checkDuplicatePhrase();
        }, 250);
      });
    }
  }

  bindDynamicHandlers();
});
