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
  const nextUrl = new URL(window.location.href);
  nextUrl.search = newParams.toString();
  window.history.replaceState({}, "", nextUrl);

  bindDynamicHandlers();

  if (statusMessage) {
    setStatus(document.querySelector(".sort-status"), statusMessage, "success");
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
  const button = postForm.querySelector("button[type='submit']");
  const currentSort = document.querySelector("#sort")?.value || "recent";
  const currentAuthor = document.querySelector("#author")?.value || "";

  setStatus(postStatus, "Posting...", "pending");
  if (button) {
    button.disabled = true;
  }

  try {
    const body = new URLSearchParams(new FormData(postForm));
    body.set("sort", currentSort);
    body.set("author", currentAuthor);

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

    bindDynamicHandlers();

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

async function handleRatingSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const status = form.querySelector(".rating-status");
  const summaryValue = form.closest(".lukia-card")?.querySelector("[data-rating-summary-value]");
  const summaryCount = form.closest(".lukia-card")?.querySelector("[data-rating-summary-count]");
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
  const loginForm = document.querySelector("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLoginSubmit);
  }

  const postForm = document.querySelector("#post-form");
  if (postForm) {
    postForm.addEventListener("submit", handlePostSubmit);
  }

  bindDynamicHandlers();
});
