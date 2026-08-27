# eRentals Expense Manager

A full-stack expense, customer, order, vendor, person, payment, and profitability
dashboard. The same source supports both the existing ChatGPT Sites deployment
and a standard Next.js deployment on Netlify.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Deploy on Netlify

1. In Netlify, choose **Add new project** and import
   `github.com/abdulerentals-sys/erentals-expense-manager`.
2. Select the `main` branch. Netlify reads `netlify.toml`, uses Node.js 22.13,
   and runs `npm run build:netlify` automatically.
3. Keep the project **private** or enable visitor password protection before
   entering customer or financial data.
4. Create a MongoDB Atlas cluster and database user, then add its connection
   string to Netlify as the private `MONGODB_URI` environment variable. Keep
   `MONGODB_DB_NAME` as `erentals_expense_manager` unless you want another name.
5. Add `AUTH_SECRET` as a random value of at least 32 characters. Add
   `ADMIN_EMAIL` and a strong temporary `ADMIN_INITIAL_PASSWORD` for the first
   administrator. Store all three as private Netlify environment variables.
6. Start the first deployment. The app creates the `users`, `customers`, `persons`,
   `vendors`, `vendor_products`, `orders`, `order_vendors`, `expenses`, and `payments` collections and their
   indexes automatically on the first request.
7. Sign in with `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD`. The app immediately
   requires the administrator to choose a private replacement password.
8. Receipt uploads are stored in the site-wide
   `erentals-documents` Netlify Blobs store. No manual storage key is required
   when the app runs on Netlify.

The first Netlify deployment starts with an empty database and document store.
Existing data in the ChatGPT Sites D1/R2 resources is not copied automatically.

### Netlify commands

- `npm run build:netlify`: create the production Next.js build used by Netlify
- `npm run dev:netlify`: run the Netlify-targeted Next.js development server
- `npx netlify dev`: run locally with MongoDB and Netlify Blobs after the
  repository has been linked to a Netlify project and `MONGODB_URI` is set

Netlify's current OpenNext adapter is applied automatically, so this repository
does not pin the legacy `@netlify/plugin-nextjs` package.

## Email login and role dashboards

All dashboard pages, data APIs, and document endpoints require a signed,
HttpOnly session cookie. Passwords are stored as salted PBKDF2 hashes and every
new account must replace its temporary password at first sign-in.

- **Administrator:** every dashboard, order editing, and team account management
- **Accountant:** customers, vendors, expenses, order-linked customer receipts,
  vendor payouts, and reports
- **Supervisor:** customers, people, orders, and execution expenses
- **Sales person:** customers, people, orders, and order-linked customer
  receipts (vendor payouts are not permitted)

The order dashboard includes a complete chronological history of vendor
assignments, expenses, customer receipts, and vendor payments. Every payment is
linked to an order ID; the selected order supplies the customer, while outgoing
payments also require a vendor assigned to that order. Administrators and
accountants may edit customer receipts and vendor payouts. Sales people may edit
customer receipts only.

Existing invoice records and their legacy database storage remain untouched for
backward compatibility, but the standalone invoice workspace and new invoice
entry workflow have been removed in favor of order-linked accounting.

Administrators create additional accounts from **Team access** in the sidebar.
Each non-administrator login is linked directly to an active record from
**People**; the person and login email do not need to match. Salespeople and
supervisors selected on an order therefore come directly from the team list,
while the explicit Team access link determines which supervisor dashboard owns
that order.

Vendor dashboards include an editable product catalog. Products may be priced
quantity-wise, length-wise, or area-based, with the existing per-day/per-event
rental basis applied afterward. Deleting a catalog product is a soft deletion,
so it disappears from new assignments while existing order history remains
unchanged.

Temporary passwords should be shared through a secure channel, never committed
to the repository or placed in a public issue.

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout and then validates the Sites artifact. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` defines the existing Sites D1 schema
- `app/api/records/mongodb.ts` stores every Netlify form record in MongoDB
- `app/api/upload/netlify.ts` stores receipt files in Netlify Blobs
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build and validate the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build, validate, and verify the rendered development-preview metadata
- `npm run validate:artifact`: recheck an existing artifact's manifest and ESM `default.fetch` export
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build and validation commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
