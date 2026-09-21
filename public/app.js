const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const accountButton = document.querySelector("#accountButton");
const uploadButton = document.querySelector("#uploadButton");
const followingButton = document.querySelector("#followingButton");
const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const authTitle = document.querySelector("#authTitle");
const authSubmit = document.querySelector("#authSubmit");
const authError = document.querySelector("#authError");
const toggleAuthMode = document.querySelector("#toggleAuthMode");
const closeAuth = document.querySelector("#closeAuth");

const state = {
  user: null,
  authMode: "login",
  loading: false
};

const popularTags = ["launch", "creators", "documentary", "design", "motion", "latam", "platform", "ui"];

boot();

async function boot() {
  bindShell();
  await refreshSession();
  route();
}

function bindShell() {
  window.addEventListener("hashchange", route);

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const nav = button.dataset.nav;
      if (nav === "discover") location.hash = "#/";
      if (nav === "subscriptions") location.hash = "#/following";
      if (nav === "upload") location.hash = "#/upload";
    });
  });

  uploadButton.addEventListener("click", () => {
    location.hash = "#/upload";
  });

  followingButton.addEventListener("click", () => {
    location.hash = "#/following";
  });

  accountButton.addEventListener("click", () => {
    if (state.user) location.hash = `#/@${state.user.handle}`;
    else openAuth("login");
  });

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = searchInput.value.trim();
    location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/";
  });

  toggleAuthMode.addEventListener("click", () => {
    openAuth(state.authMode === "login" ? "register" : "login");
  });

  closeAuth.addEventListener("click", () => authDialog.close());

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAuth();
  });
}

async function refreshSession() {
  const data = await api("/api/session");
  state.user = data.user;
  renderAccountButton();
}

function renderAccountButton() {
  if (state.user) {
    accountButton.textContent = state.user.avatar;
    accountButton.classList.add("is-user");
    accountButton.title = state.user.name;
  } else {
    accountButton.textContent = "Sign in";
    accountButton.classList.remove("is-user");
    accountButton.removeAttribute("title");
  }
}

async function route() {
  const hash = location.hash || "#/";
  setActiveRail(hash);

  if (hash.startsWith("#/watch/")) {
    await renderWatch(hash.replace("#/watch/", ""));
    return;
  }

  if (hash.startsWith("#/@")) {
    await renderProfile(hash.replace("#/@", ""));
    return;
  }

  if (hash.startsWith("#/search/")) {
    const q = decodeURIComponent(hash.replace("#/search/", ""));
    searchInput.value = q;
    await renderFeed({ search: q, title: `Search: ${q}`, subtitle: "Frames, creators, and tags matching your search." });
    return;
  }

  if (hash.startsWith("#/tag/")) {
    const tag = decodeURIComponent(hash.replace("#/tag/", ""));
    await renderFeed({ tag, title: `#${tag}`, subtitle: "Public videos using this tag." });
    return;
  }

  if (hash === "#/following") {
    if (!state.user) {
      renderGate("Following", "Sign in to see new frames from creators you subscribe to.");
      return;
    }
    await renderFeed({ feed: "subscriptions", title: "Following", subtitle: "Latest public uploads from your subscriptions." });
    return;
  }

  if (hash === "#/upload") {
    renderUpload();
    return;
  }

  await renderFeed({
    title: "Watch what matters.",
    subtitle: "Fresh frames from creators across film, design, cities, music, culture, and everything that deserves a closer look."
  });
}

function setActiveRail(hash) {
  document.querySelectorAll("[data-nav]").forEach((button) => button.classList.remove("active"));
  const key = hash === "#/following" ? "subscriptions" : hash === "#/upload" ? "upload" : "discover";
  const active = document.querySelector(`[data-nav="${key}"]`);
  if (active) active.classList.add("active");
}

async function renderFeed(options = {}) {
  setLoading();
  const params = new URLSearchParams();
  if (options.search) params.set("search", options.search);
  if (options.feed) params.set("feed", options.feed);
  if (options.tag) params.set("tag", options.tag);
  const data = await api(`/api/videos?${params}`);
  const title = options.title || "Discover";
  const subtitle = options.subtitle || "Explore public videos from the Framered community.";

  app.innerHTML = `
    <header class="view-header">
      <div>
        <p class="eyebrow">framered.lat</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <button class="primary-button" data-action="upload" type="button">Upload frame</button>
    </header>
    <nav class="tag-strip" aria-label="Popular tags">
      ${popularTags.map((tag) => `<button class="chip ${options.tag === tag ? "active" : ""}" data-tag="${tag}" type="button">#${tag}</button>`).join("")}
    </nav>
    ${data.videos.length ? `<section class="video-grid">${data.videos.map(videoCard).join("")}</section>` : emptyState("No frames yet", "Upload the first public video for this view.")}
  `;

  app.querySelector("[data-action='upload']").addEventListener("click", () => {
    location.hash = "#/upload";
  });
  app.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = `#/tag/${encodeURIComponent(button.dataset.tag)}`;
    });
  });
}

async function renderWatch(id) {
  setLoading();
  const data = await api(`/api/videos/${encodeURIComponent(id)}`);
  const video = data.video;

  app.innerHTML = `
    <section class="watch-layout">
      <div>
        ${player(video)}
        <div class="watch-copy">
          <h1>${escapeHtml(video.title)}</h1>
          <p>${formatNumber(video.views)} views · ${timeAgo(video.createdAt)}</p>
        </div>
        <div class="creator-row">
          <a class="creator-left" href="#/@${video.owner.handle}">
            <span class="avatar">${escapeHtml(video.owner.avatar)}</span>
            <span>
              <strong>${escapeHtml(video.owner.name)}</strong>
              <br>
              <span class="muted">@${escapeHtml(video.owner.handle)} · ${formatNumber(video.owner.subscriberCount)} subscribers</span>
            </span>
          </a>
          <div class="action-row">
            <button class="ghost-button" data-action="like" type="button">${video.liked ? "Liked" : "Like"} · ${formatNumber(video.likeCount)}</button>
            <button class="primary-button" data-action="subscribe" type="button">${video.owner.isSubscribed ? "Subscribed" : "Subscribe"}</button>
          </div>
        </div>
        <p>${escapeHtml(video.description || "No description.")}</p>
        <div class="tag-strip">
          ${video.tags.map((tag) => `<a class="chip" href="#/tag/${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`).join("")}
        </div>
        <section class="comments">
          <h2>Comments</h2>
          <form class="comment-form" id="commentForm">
            <input id="commentText" type="text" placeholder="${state.user ? "Add a comment" : "Sign in to comment"}" ${state.user ? "" : "disabled"}>
            <button class="primary-button" type="submit" ${state.user ? "" : "disabled"}>Post</button>
          </form>
          <div class="comment-list" id="commentList"></div>
        </section>
      </div>
      <aside>
        <h2>More frames</h2>
        <div class="side-list" id="sideList"></div>
      </aside>
    </section>
  `;

  app.querySelector("[data-action='like']").addEventListener("click", async () => {
    if (!state.user) return openAuth("login");
    const updated = await api(`/api/videos/${video.id}/like`, { method: "POST" });
    showToast(updated.video.liked ? "Liked" : "Like removed");
    renderWatch(video.id);
  });

  app.querySelector("[data-action='subscribe']").addEventListener("click", async () => {
    if (!state.user) return openAuth("login");
    if (video.owner.isSelf) return showToast("That is your own channel.");
    const result = await api(`/api/users/${video.owner.handle}/subscribe`, { method: "POST" });
    showToast(result.subscribed ? "Subscribed" : "Subscription removed");
    renderWatch(video.id);
  });

  app.querySelector("#commentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = app.querySelector("#commentText");
    const text = input.value.trim();
    if (!text) return;
    await api(`/api/videos/${video.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    input.value = "";
    await loadComments(video.id);
  });

  await Promise.all([loadComments(video.id), loadSideList(video.id)]);
}

function player(video) {
  if (video.src) {
    return `<video class="player" controls playsinline poster="${escapeAttr(video.poster)}" src="${escapeAttr(video.src)}"></video>`;
  }
  return `
    <div class="player demo-player">
      <img src="${escapeAttr(video.poster)}" alt="">
      <strong>▶</strong>
    </div>
  `;
}

async function loadComments(videoId) {
  const data = await api(`/api/videos/${videoId}/comments`);
  const list = app.querySelector("#commentList");
  list.innerHTML = data.comments.length
    ? data.comments.map((comment) => `
        <article class="comment">
          <span class="avatar">${escapeHtml(comment.author ? comment.author.avatar : "FR")}</span>
          <div>
            <strong>${escapeHtml(comment.author ? comment.author.name : "Framered")}</strong>
            <span class="muted"> · ${timeAgo(comment.createdAt)}</span>
            <p>${escapeHtml(comment.text)}</p>
          </div>
        </article>
      `).join("")
    : `<p class="muted">No comments yet.</p>`;
}

async function loadSideList(currentId) {
  const data = await api("/api/videos");
  const sideList = app.querySelector("#sideList");
  sideList.innerHTML = data.videos
    .filter((video) => video.id !== currentId)
    .slice(0, 5)
    .map(videoCard)
    .join("") || `<p class="muted">Nothing else yet.</p>`;
}

async function renderProfile(handle) {
  setLoading();
  const data = await api(`/api/users/${encodeURIComponent(handle)}`);
  const profile = data.user;
  app.innerHTML = `
    <section>
      <div class="profile-bar">
        <div class="profile-left">
          <span class="avatar">${escapeHtml(profile.avatar)}</span>
          <div class="profile-copy">
            <h1>${escapeHtml(profile.name)}</h1>
            <p>@${escapeHtml(profile.handle)} · ${formatNumber(profile.subscriberCount)} subscribers · ${formatNumber(profile.subscriptionCount)} following</p>
          </div>
        </div>
        <div class="action-row">
          ${profile.isSelf ? `<button class="ghost-button" data-action="logout" type="button">Log out</button>` : `<button class="primary-button" data-action="subscribe" type="button">${profile.isSubscribed ? "Subscribed" : "Subscribe"}</button>`}
        </div>
      </div>
      <p>${escapeHtml(profile.bio)}</p>
      <div class="video-grid">
        ${data.videos.map(videoCard).join("") || emptyState("No public uploads", "This creator has not published a frame yet.")}
      </div>
    </section>
  `;

  const subscribe = app.querySelector("[data-action='subscribe']");
  if (subscribe) {
    subscribe.addEventListener("click", async () => {
      if (!state.user) return openAuth("login");
      const result = await api(`/api/users/${profile.handle}/subscribe`, { method: "POST" });
      showToast(result.subscribed ? "Subscribed" : "Subscription removed");
      renderProfile(profile.handle);
    });
  }

  const logout = app.querySelector("[data-action='logout']");
  if (logout) {
    logout.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      renderAccountButton();
      showToast("Signed out");
      location.hash = "#/";
    });
  }
}

function renderUpload() {
  if (!state.user) {
    renderGate("Upload", "Sign in to publish a frame on Framered.");
    return;
  }

  app.innerHTML = `
    <header class="view-header">
      <div>
        <p class="eyebrow">creator studio</p>
        <h1>Upload a frame.</h1>
        <p>Publish MP4, WebM, MOV, or M4V files with a poster, tags, and public or private visibility.</p>
      </div>
    </header>
    <form class="upload-panel" id="uploadForm">
      <div class="upload-grid">
        <label>
          Title
          <input name="title" required maxlength="100" placeholder="A sharp title">
        </label>
        <label>
          Tags
          <input name="tags" maxlength="120" placeholder="design, cities, music">
        </label>
      </div>
      <label>
        Description
        <textarea name="description" maxlength="800" placeholder="What should viewers know?"></textarea>
      </label>
      <div class="upload-grid">
        <label>
          Video file
          <input name="video" type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" required>
        </label>
        <label>
          Poster image
          <input name="poster" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml">
        </label>
      </div>
      <div class="upload-grid">
        <label>
          Duration label
          <input name="duration" maxlength="24" placeholder="03:48">
        </label>
        <label>
          Visibility
          <select name="visibility">
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
      </div>
      <button class="primary-button wide" type="submit">Publish</button>
    </form>
  `;

  app.querySelector("#uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "Publishing...";
    try {
      const data = await api("/api/videos", {
        method: "POST",
        body: new FormData(form),
        rawBody: true
      });
      showToast("Video published");
      location.hash = `#/watch/${data.video.id}`;
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.textContent = "Publish";
    }
  });
}

function renderGate(title, message) {
  app.innerHTML = `
    <section class="empty-state">
      <div>
        <p class="eyebrow">framered.lat</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <button class="primary-button" data-action="signin" type="button">Sign in</button>
      </div>
    </section>
  `;
  app.querySelector("[data-action='signin']").addEventListener("click", () => openAuth("login"));
}

function videoCard(video) {
  return `
    <article class="video-card">
      <a class="thumb" href="#/watch/${video.id}" aria-label="Watch ${escapeAttr(video.title)}">
        <img src="${escapeAttr(video.poster || "/assets/poster-fallback.svg")}" alt="">
        <span class="duration">${escapeHtml(video.duration || "new")}</span>
      </a>
      <div class="video-meta">
        <a class="avatar" href="#/@${video.owner.handle}">${escapeHtml(video.owner.avatar)}</a>
        <div>
          <h3><a href="#/watch/${video.id}">${escapeHtml(video.title)}</a></h3>
          <p><a href="#/@${video.owner.handle}">${escapeHtml(video.owner.name)}</a></p>
          <p>${formatNumber(video.views)} views · ${timeAgo(video.createdAt)}</p>
        </div>
      </div>
    </article>
  `;
}

function emptyState(title, body) {
  return `
    <section class="empty-state">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
      </div>
    </section>
  `;
}

function setLoading() {
  app.innerHTML = `
    <section class="empty-state">
      <div>
        <p class="eyebrow">framered.lat</p>
        <h2>Loading</h2>
      </div>
    </section>
  `;
}

function openAuth(mode) {
  state.authMode = mode;
  authForm.classList.toggle("is-register", mode === "register");
  authTitle.textContent = mode === "register" ? "Create account" : "Sign in";
  authSubmit.textContent = mode === "register" ? "Create account" : "Sign in";
  toggleAuthMode.textContent = mode === "register" ? "Already have an account" : "Create an account";
  authError.textContent = "";
  if (!authDialog.open) authDialog.showModal();
}

async function submitAuth() {
  authError.textContent = "";
  const payload = {
    email: document.querySelector("#authEmail").value,
    password: document.querySelector("#authPassword").value,
    name: document.querySelector("#authName").value,
    handle: document.querySelector("#authHandle").value
  };

  try {
    const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const data = await api(path, { method: "POST", body: JSON.stringify(payload) });
    state.user = data.user;
    renderAccountButton();
    authDialog.close();
    showToast(state.authMode === "register" ? "Account created" : "Signed in");
    route();
  } catch (error) {
    authError.textContent = error.message;
  }
}

async function api(path, options = {}) {
  const headers = options.rawBody ? {} : { "Content-Type": "application/json" };
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body,
    credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) openAuth("login");
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", { notation: Number(value) > 9999 ? "compact" : "standard" }).format(Number(value) || 0);
}

function timeAgo(dateString) {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
