import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { verifyPassword } from "../lib/auth.js";

const router: IRouter = Router();

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const user = await db.query.usersTable.findFirst({ where: (u, { eq }) => eq(u.email, email.toLowerCase().trim()) });

  if (!user) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(
    (await import("drizzle-orm")).eq(usersTable.id, user.id)
  );

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.email = user.email;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Session error" });
      return;
    }
    res.json({ role: user.role, email: user.email });
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/auth/me", (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ userId: req.session.userId, role: req.session.role, email: req.session.email });
});

router.get("/auth/tenant", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = await db.query.usersTable.findFirst({ where: (u, { eq }) => eq(u.id, req.session.userId!) });
  if (!user?.tenantId) {
    res.status(404).json({ error: "No tenant found" });
    return;
  }
  res.json({ tenantId: user.tenantId });
});

export default router;
