import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));

app.use(
  session({
    secret: process.env["SESSION_SECRET"] ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.get("/login", (_req, res) => {
  res.sendFile(join(__dirname, "../public/login.html"));
});

app.use("/admin", (req, res, next) => {
  if (!req.path.includes(".")) {
    res.sendFile(join(__dirname, "../public/admin/index.html"));
  } else {
    next();
  }
});

app.use("/portal", (req, res, next) => {
  if (!req.path.includes(".")) {
    res.sendFile(join(__dirname, "../public/portal/index.html"));
  } else {
    next();
  }
});

app.use(
  express.static(join(__dirname, "../public"), {
    setHeaders(res) {
      if (process.env["NODE_ENV"] !== "production") {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }),
);

export default app;
