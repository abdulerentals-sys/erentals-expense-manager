import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("email login uses a protected HttpOnly session cookie", async () => {
  const [loginPage, loginForm, loginRoute, logoutRoute, session] = await Promise.all([
    read("app/login/page.tsx"),
    read("app/components/LoginForm.tsx"),
    read("app/api/auth/login/route.ts"),
    read("app/api/auth/logout/route.ts"),
    read("app/auth/session.ts"),
  ]);

  assert.match(loginPage, /LoginForm/);
  assert.match(loginForm, /type="email"/);
  assert.match(loginRoute, /verifyPassword/);
  assert.match(logoutRoute, /clearSession/);
  assert.match(session, /httpOnly:\s*true/);
  assert.match(session, /sameSite:\s*"lax"/);
  assert.match(session, /maxAge:\s*0/);
});

test("roles protect record writes and expose an admin user workspace", async () => {
  const [permissions, records, usersPage] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/api/records/route.ts"),
    read("app/users/page.tsx"),
  ]);

  for (const role of ["admin", "accountant", "supervisor", "sales"]) {
    assert.match(permissions, new RegExp(`\\b${role}:`));
  }
  assert.match(records, /canCreateRecord/);
  assert.match(usersPage, /UserManagement/);
});

test("the official eRentals logo is used in the authenticated dashboard", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");
  assert.match(dashboard, /\/erentals-logo\.png/);
});
