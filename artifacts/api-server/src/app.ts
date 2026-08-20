import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const PgStore = connectPgSimple(session);

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

app.use(cors({ origin: true }));

// CSP for widget script and API responses
app.use((req, res, next) => {
  const isWidgetScript = req.path.startsWith("/embed/") && req.path.endsWith("widget.js");
  const isApi = req.path.startsWith("/api/");
  if (isWidgetScript) {
    // Widget JS injects a <style> element inline, needs 'unsafe-inline' for style-src
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors *;"
    );
  } else if (isApi) {
    // API responses are JSON, minimal CSP
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none';"
    );
  }
  next();
});

app.use(
  session({
    store: new PgStore({
      conString: process.env["DATABASE_URL"],
      tableName: "session",
      createTableIfMissing: false,
    }),
    secret: process.env["SESSION_SECRET"] ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Rate limit the chat endpoint — 10 messages/minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait a moment and try again." },
});
app.use("/api/chat", chatLimiter);

// Rate limit the public Buy Now endpoint — 30 submissions/hour per IP.
// It triggers outbound email, so guard against spam/cost amplification while
// staying generous enough for real prospects (and multiple users behind one IP).
const buyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a little while." },
});
app.use("/api/buy", buyLimiter);

// Rate limit the public availability checker — 20/minute per IP.
// It's unauthenticated and queries the Google Calendar freeBusy API, so cap it
// to prevent calendar-occupancy probing and API-cost amplification.
const availabilityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
});
app.use("/api/check-availability", availabilityLimiter);

app.use("/api", router);

export default app;
