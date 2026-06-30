import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "./state.mjs";

const SESSION_REVIEWS_FILE_NAME = "session-reviews.json";

function nowIso() {
  return new Date().toISOString();
}

function resolveSessionReviewsFile(cwd) {
  return path.join(resolveStateDir(cwd), SESSION_REVIEWS_FILE_NAME);
}

function loadSessionReviews(cwd) {
  const filePath = resolveSessionReviewsFile(cwd);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveSessionReviews(cwd, reviews) {
  const filePath = resolveSessionReviewsFile(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(reviews, null, 2)}\n`, "utf8");
  return reviews;
}

export function getSessionReview(cwd, sessionId) {
  if (!sessionId) {
    return null;
  }
  return loadSessionReviews(cwd)[sessionId] ?? null;
}

export function upsertSessionReview(cwd, sessionId, patch) {
  if (!sessionId) {
    return loadSessionReviews(cwd);
  }
  const reviews = loadSessionReviews(cwd);
  return saveSessionReviews(cwd, {
    ...reviews,
    [sessionId]: {
      ...(reviews[sessionId] ?? {}),
      ...patch,
      updatedAt: nowIso()
    }
  });
}

export function clearSessionReview(cwd, sessionId) {
  if (!sessionId) {
    return loadSessionReviews(cwd);
  }
  const filePath = resolveSessionReviewsFile(cwd);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const nextSessionReviews = { ...loadSessionReviews(cwd) };
  if (!Object.prototype.hasOwnProperty.call(nextSessionReviews, sessionId)) {
    return nextSessionReviews;
  }
  delete nextSessionReviews[sessionId];
  return saveSessionReviews(cwd, nextSessionReviews);
}
