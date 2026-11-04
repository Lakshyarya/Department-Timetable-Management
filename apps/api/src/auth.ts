import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./timetable.js";

const secret = () => process.env.AUTH_SECRET ?? "change-this-development-secret";
export type AuthUser = { id: string; name: string; email: string; role: "ADMIN" | "COORDINATOR" | "FACULTY" };
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const hashPassword = (password: string) => new Promise<string>((resolve, reject) => {
  const salt = crypto.randomBytes(16).toString("hex");
  crypto.scrypt(password, salt, 64, (error, derived) => error ? reject(error) : resolve(`${salt}:${derived.toString("hex")}`));
});
export const verifyPassword = (password: string, stored: string) => new Promise<boolean>((resolve, reject) => {
  const [salt, value] = stored.split(":"); if (!salt || !value) return resolve(false);
  crypto.scrypt(password, salt, 64, (error, derived) => error ? reject(error) : resolve(crypto.timingSafeEqual(Buffer.from(value, "hex"), derived)));
});
export const signToken = (user: AuthUser) => { const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 1000 * 60 * 60 * 12 })).toString("base64url"); const signature = crypto.createHmac("sha256", secret()).update(payload).digest("base64url"); return `${payload}.${signature}`; };
const parseToken = (token: string): AuthUser | undefined => { const [payload, signature] = token.split("."); if (!payload || !signature) return; const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url"); if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return; try { const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as AuthUser & { exp: number }; return parsed.exp > Date.now() ? { id: parsed.id, name: parsed.name, email: parsed.email, role: parsed.role } : undefined; } catch { return; } };
export const authenticate = async (request: Request, response: Response, next: NextFunction) => { const token = request.header("authorization")?.replace(/^Bearer\s+/i, ""); const user = token ? parseToken(token) : undefined; if (!user) return response.status(401).json({ error: "Sign in is required." }); const current = await prisma.user.findUnique({ where: { id: user.id } }); if (!current?.isActive) return response.status(401).json({ error: "Account is inactive." }); request.user = user; if (request.method !== "GET" && user.role === "FACULTY") return response.status(403).json({ error: "Your role has read-only access." }); next(); };
