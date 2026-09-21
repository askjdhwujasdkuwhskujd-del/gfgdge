const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const STORAGE_DIR = path.join(ROOT, "storage");
const VIDEO_DIR = path.join(STORAGE_DIR, "videos");
const POSTER_DIR = path.join(STORAGE_DIR, "posters");
const DB_PATH = path.join(STORAGE_DIR, "db.json");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "framered_session";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 250);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v"
};

const allowedVideoExt = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const allowedPosterExt = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

ensureProjectFiles();
let db = loadDb();

const migrationChanged = migrateDb();
if (migrationChanged) saveDb();

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Framered is running at ${PUBLIC_URL}`);
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  if (pathname.startsWith("/media/videos/")) {
    serveMedia(res, VIDEO_DIR, pathname.replace("/media/videos/", ""));
    return;
  }

  if (pathname.startsWith("/media/posters/")) {
    serveMedia(res, POSTER_DIR, pathname.replace("/media/posters/", ""));
    return;
  }

  serveStatic(req, res, pathname);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const user = getCurrentUser(req);

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "framered", version: "1.0.0" });
    return;
  }

  if (req.method === "GET" && pathname === "/api/session") {
    sendJson(res, 200, { user: user ? publicUser(user) : null });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    const body = await readJson(req);
    const username = cleanHandle(body.username || body.handle || body.name);
    const name = cleanText(body.name || username, 60);
    const password = String(body.password || "");

    if (!username || password.length < 6) {
      sendJson(res, 400, { error: "Use a username and password with at least 6 characters." });
      return;
    }

    if (db.users.some((candidate) => (candidate.username || candidate.handle) === username)) {
      sendJson(res, 409, { error: "That username is already taken." });
      return;
    }

    const newUser = {
      id: makeId("usr"),
      name,
      username,
      handle: username,
      passwordHash: hashPassword(password),
      avatar: initialsAvatar(name),
      bio: "New creator on Framered.",
      createdAt: new Date().toISOString(),
      subscribers: [],
      subscriptions: []
    };

    db.users.push(newUser);
    const token = createSession(newUser.id);
    saveDb();
    setSessionCookie(res, token);
    sendJson(res, 201, { user: publicUser(newUser) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(req);
    const username = cleanHandle(body.username || body.handle || body.email || "");
    const password = String(body.password || "");
    const matchedUser = db.users.find((candidate) => (candidate.username || candidate.handle) === username);

    if (!matchedUser || !verifyPassword(password, matchedUser.passwordHash)) {
      sendJson(res, 401, { error: "Invalid username or password." });
      return;
    }

    const token = createSession(matchedUser.id);
    saveDb();
    setSessionCookie(res, token);
    sendJson(res, 200, { user: publicUser(matchedUser) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = readCookie(req, COOKIE_NAME);
    if (token) delete db.sessions[hashToken(token)];
    saveDb();
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/videos") {
    const query = cleanText(url.searchParams.get("search") || "", 100).toLowerCase();
    const handle = cleanHandle(url.searchParams.get("user") || "");
    const feed = url.searchParams.get("feed") || "discover";
    const tag = cleanTag(url.searchParams.get("tag") || "");
    let videos = db.videos.filter((video) => video.visibility === "public");

    if (handle) {
      const owner = db.users.find((candidate) => candidate.handle === handle);
      videos = owner ? videos.filter((video) => video.ownerId === owner.id) : [];
    }

    if (feed === "subscriptions" && user) {
      videos = videos.filter((video) => user.subscriptions.includes(video.ownerId));
    }

    if (tag) {
      videos = videos.filter((video) => video.tags.includes(tag));
    }

    if (query) {
      videos = videos.filter((video) => {
        const owner = findUser(video.ownerId);
        const haystack = [video.title, video.description, video.tags.join(" "), owner ? owner.name : ""].join(" ").toLowerCase();
        return haystack.includes(query);
      });
    }

    videos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sendJson(res, 200, { videos: videos.map((video) => publicVideo(video, user)) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/videos") {
    if (!user) {
      sendJson(res, 401, { error: "Sign in to upload videos." });
      return;
    }

    const { fields, files } = await readMultipart(req);
    const videoFile = files.video || files.file;
    if (!videoFile || !videoFile.filename) {
      sendJson(res, 400, { error: "Choose a video file to upload." });
      return;
    }

    const videoExt = safeExtension(videoFile.filename, allowedVideoExt);
    if (!videoExt) {
      sendJson(res, 400, { error: "Supported video formats: mp4, webm, mov, m4v." });
      return;
    }

    const id = makeId("vid");
    const videoName = `${id}${videoExt}`;
    fs.writeFileSync(path.join(VIDEO_DIR, videoName), videoFile.data);

    let posterPath = "/assets/poster-fallback.svg";
    const posterFile = files.poster;
    if (posterFile && posterFile.filename && posterFile.data.length > 0) {
      const posterExt = safeExtension(posterFile.filename, allowedPosterExt);
      if (posterExt) {
        const posterName = `${id}${posterExt}`;
        fs.writeFileSync(path.join(POSTER_DIR, posterName), posterFile.data);
        posterPath = `/media/posters/${posterName}`;
      }
    }

    const title = cleanText(fields.title || "Untitled frame", 100);
    const description = cleanText(fields.description || "", 800);
    const tags = parseTags(fields.tags || "");
    const newVideo = {
      id,
      ownerId: user.id,
      title,
      description,
      tags,
      visibility: fields.visibility === "private" ? "private" : "public",
      src: `/media/videos/${videoName}`,
      poster: posterPath,
      duration: cleanText(fields.duration || "", 24),
      views: 0,
      likes: [],
      comments: [],
      createdAt: new Date().toISOString()
    };

    db.videos.push(newVideo);
    saveDb();
    sendJson(res, 201, { video: publicVideo(newVideo, user) });
    return;
  }

  const videoMatch = pathname.match(/^\/api\/videos\/([^/]+)(?:\/([^/]+))?$/);
  if (videoMatch) {
    const id = videoMatch[1];
    const action = videoMatch[2] || "";
    const video = db.videos.find((candidate) => candidate.id === id);

    if (!video || (video.visibility !== "public" && (!user || user.id !== video.ownerId))) {
      sendJson(res, 404, { error: "Video not found." });
      return;
    }

    if (req.method === "GET" && !action) {
      video.views += 1;
      saveDb();
      sendJson(res, 200, { video: publicVideo(video, user) });
      return;
    }

    if (req.method === "POST" && action === "like") {
      if (!user) {
        sendJson(res, 401, { error: "Sign in to like videos." });
        return;
      }
      toggleValue(video.likes, user.id);
      saveDb();
      sendJson(res, 200, { video: publicVideo(video, user) });
      return;
    }

    if (req.method === "GET" && action === "comments") {
      sendJson(res, 200, { comments: video.comments.map(publicComment) });
      return;
    }

    if (req.method === "POST" && action === "comments") {
      if (!user) {
        sendJson(res, 401, { error: "Sign in to comment." });
        return;
      }
      const body = await readJson(req);
      const text = cleanText(body.text || "", 500);
      if (!text) {
        sendJson(res, 400, { error: "Write a comment first." });
        return;
      }
      const comment = {
        id: makeId("cmt"),
        userId: user.id,
        text,
        createdAt: new Date().toISOString()
      };
      video.comments.push(comment);
      saveDb();
      sendJson(res, 201, { comment: publicComment(comment) });
      return;
    }
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)(?:\/([^/]+))?$/);
  if (userMatch) {
    const handle = cleanHandle(userMatch[1]);
    const action = userMatch[2] || "";
    const profile = db.users.find((candidate) => candidate.handle === handle);

    if (!profile) {
      sendJson(res, 404, { error: "Profile not found." });
      return;
    }

    if (req.method === "GET" && !action) {
      const videos = db.videos
        .filter((video) => video.ownerId === profile.id && video.visibility === "public")
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      sendJson(res, 200, {
        user: publicUser(profile, user),
        videos: videos.map((video) => publicVideo(video, user))
      });
      return;
    }

    if (req.method === "POST" && action === "subscribe") {
      if (!user) {
        sendJson(res, 401, { error: "Sign in to subscribe." });
        return;
      }
      if (user.id === profile.id) {
        sendJson(res, 400, { error: "You cannot subscribe to yourself." });
        return;
      }
      const subscribed = toggleSubscription(user, profile);
      saveDb();
      sendJson(res, 200, { subscribed, user: publicUser(profile, user) });
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/search") {
    const query = cleanText(url.searchParams.get("q") || "", 100).toLowerCase();
    const videos = [];
    const users = [];
    const tags = new Set();

    if (query) {
      for (const video of db.videos) {
        if (video.visibility !== "public") continue;
        const owner = findUser(video.ownerId);
        const haystack = [video.title, video.description, video.tags.join(" "), owner ? owner.name : ""].join(" ").toLowerCase();
        if (haystack.includes(query)) videos.push(publicVideo(video, user));
        for (const tag of video.tags) {
          if (tag.includes(query)) tags.add(tag);
        }
      }
      for (const candidate of db.users) {
        if (`${candidate.name} ${candidate.handle} ${candidate.bio}`.toLowerCase().includes(query)) {
          users.push(publicUser(candidate, user));
        }
      }
    }

    sendJson(res, 200, { videos, users, tags: Array.from(tags).slice(0, 12) });
    return;
  }

  sendJson(res, 404, { error: "Route not found." });
}

function ensureProjectFiles() {
  for (const dir of [PUBLIC_DIR, STORAGE_DIR, VIDEO_DIR, POSTER_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(seedDb(), null, 2));
  }
}

function loadDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function migrateDb() {
  let changed = false;
  const seededUserIds = new Set(["usr_demo", "usr_maya", "usr_renato"]);
  const seededVideoIds = new Set(["vid_launch", "vid_city", "vid_motion"]);

  if (!Array.isArray(db.users)) {
    db.users = [];
    changed = true;
  }
  if (!Array.isArray(db.videos)) {
    db.videos = [];
    changed = true;
  }
  if (!db.sessions || typeof db.sessions !== "object") {
    db.sessions = {};
    changed = true;
  }

  const filteredVideos = db.videos.filter((video) => !seededVideoIds.has(video.id));
  if (filteredVideos.length !== db.videos.length) {
    db.videos = filteredVideos;
    changed = true;
  }

  const filteredUsers = db.users.filter((user) => !seededUserIds.has(user.id));
  if (filteredUsers.length !== db.users.length) {
    db.users = filteredUsers;
    changed = true;
  }

  const validUserIds = new Set(db.users.map((user) => user.id));
  for (const user of db.users) {
    const username = cleanHandle(user.username || user.handle || user.name);
    if (user.username !== username || user.handle !== username) {
      user.username = username;
      user.handle = username;
      changed = true;
    }
    if (!Array.isArray(user.subscribers)) {
      user.subscribers = [];
      changed = true;
    }
    if (!Array.isArray(user.subscriptions)) {
      user.subscriptions = [];
      changed = true;
    }
    const subscribers = user.subscribers.filter((id) => validUserIds.has(id));
    const subscriptions = user.subscriptions.filter((id) => validUserIds.has(id));
    if (subscribers.length !== user.subscribers.length || subscriptions.length !== user.subscriptions.length) {
      user.subscribers = subscribers;
      user.subscriptions = subscriptions;
      changed = true;
    }
  }

  for (const [tokenHash, session] of Object.entries(db.sessions)) {
    if (!session || !validUserIds.has(session.userId)) {
      delete db.sessions[tokenHash];
      changed = true;
    }
  }

  return changed;
}

function seedDb() {
  return {
    users: [],
    videos: [],
    sessions: {}
  };
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveMedia(res, directory, fileName) {
  const safeName = path.basename(fileName);
  const filePath = path.join(directory, safeName);

  if (!fs.existsSync(filePath) || !filePath.startsWith(directory)) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "public, max-age=86400"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function readJson(req) {
  const raw = await readBody(req, 1024 * 1024);
  if (!raw.length) return {};
  return JSON.parse(raw.toString("utf8"));
}

async function readMultipart(req) {
  const type = req.headers["content-type"] || "";
  const match = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("Missing multipart boundary.");

  const boundary = match[1] || match[2];
  const body = await readBody(req, MAX_UPLOAD_BYTES);
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let cursor = 0;

  while (cursor < body.length) {
    const start = body.indexOf(delimiter, cursor);
    if (start === -1) break;
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    let part = body.slice(start + delimiter.length, next);
    cursor = next;

    if (part.slice(0, 2).toString() === "--") continue;
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headerText = part.slice(0, headerEnd).toString("latin1");
    const data = part.slice(headerEnd + 4);
    const nameMatch = headerText.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
    if (filenameMatch) {
      files[name] = {
        filename: path.basename(filenameMatch[1]),
        contentType: (headerText.match(/Content-Type:\s*([^\r\n]+)/i) || [null, "application/octet-stream"])[1],
        data
      };
    } else {
      fields[name] = data.toString("utf8");
    }
  }

  return { fields, files };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getCurrentUser(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const session = db.sessions[hashToken(token)];
  if (!session || new Date(session.expiresAt) < new Date()) return null;
  return findUser(session.userId);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[hashToken(token)] = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
  };
  return token;
}

function readCookie(req, name) {
  const cookie = req.headers.cookie || "";
  for (const entry of cookie.split(";")) {
    const [key, ...valueParts] = entry.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return "";
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function findUser(id) {
  return db.users.find((user) => user.id === id) || null;
}

function publicUser(profile, viewer = null) {
  return {
    id: profile.id,
    name: profile.name,
    username: profile.username || profile.handle,
    handle: profile.handle,
    avatar: profile.avatar,
    bio: profile.bio,
    createdAt: profile.createdAt,
    subscriberCount: profile.subscribers.length,
    subscriptionCount: profile.subscriptions.length,
    isSubscribed: viewer ? profile.subscribers.includes(viewer.id) : false,
    isSelf: viewer ? viewer.id === profile.id : false
  };
}

function publicVideo(video, viewer = null) {
  const owner = findUser(video.ownerId);
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    tags: video.tags,
    src: video.src,
    poster: video.poster,
    duration: video.duration,
    views: video.views,
    likeCount: video.likes.length,
    commentCount: video.comments.length,
    liked: viewer ? video.likes.includes(viewer.id) : false,
    createdAt: video.createdAt,
    owner: owner ? publicUser(owner, viewer) : null
  };
}

function publicComment(comment) {
  const author = findUser(comment.userId);
  return {
    id: comment.id,
    text: comment.text,
    createdAt: comment.createdAt,
    author: author ? publicUser(author) : null
  };
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanText(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanHandle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}

function cleanTag(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 30);
}

function parseTags(value) {
  return Array.from(new Set(String(value || "")
    .split(",")
    .map((tag) => cleanTag(tag))
    .filter(Boolean)))
    .slice(0, 8);
}

function safeExtension(fileName, allowed) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return allowed.has(ext) ? ext : "";
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || !salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function initialsAvatar(name) {
  return cleanText(name, 60)
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "FR";
}

function toggleValue(list, value) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
}

function toggleSubscription(viewer, profile) {
  const isSubscribed = profile.subscribers.includes(viewer.id);
  if (isSubscribed) {
    profile.subscribers = profile.subscribers.filter((id) => id !== viewer.id);
    viewer.subscriptions = viewer.subscriptions.filter((id) => id !== profile.id);
    return false;
  }
  profile.subscribers.push(viewer.id);
  viewer.subscriptions.push(profile.id);
  return true;
}
