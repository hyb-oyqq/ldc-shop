# LDC Shop (Next.js Edition)

[中文说明](./README.md)

---

A robust, serverless virtual goods shop built with **Next.js 16**, **Shadcn UI**, and **Linux DO Connect**.

> 🚀 **Recommended: Cloudflare Workers Deployment**
> 
> | Comparison | Cloudflare Workers | Vercel |
> |------------|-------------------|--------|
> | Free Requests | **100K/day** | Limited |
> | Database | **D1 Free 5GB** | Postgres quota |
> | Cold Start | **Near zero** | Has delay |
> | Global Edge | ✅ Worldwide | Partial |
> 
> 👉 **[View Workers Deployment Guide → `_workers_next/README.md`](./_workers_next/README.md)**

## ✨ Features
- **Modern Stack**: Next.js 16 (App Router), Tailwind CSS, TypeScript.
- **Vercel Native**: One-click deploy with Vercel Postgres database.
- **Linux DO Integration**: Built-in OIDC login and EasyPay payments.
- **Storefront Experience**:
    - 🔍 **Search & Categories**: Client-side search and category filters.
    - 📢 **Announcement Banner**: Configurable homepage announcements (supports scheduled start/end).
    - 📝 **Markdown Descriptions**: Rich product descriptions.
    - 🔥 **Hot & Discounts**: Hot tag and original/discount price display.
    - ⭐ **Ratings & Reviews**: Verified buyers can rate and review.
    - 📦 **Stock & Sold Counters**: Real-time inventory and sales display.
    - 🚫 **Purchase Limits**: Limit purchases by paid order count.
- **Orders & Delivery**:
    - ✅ **Payment Callback Verification**: Signature and amount checks.
    - 🎁 **Auto Delivery**: Card key delivery on payment; paid status retained if out of stock.
    - 🔒 **Stock Reservation**: 5-minute hold after entering checkout to prevent oversell.
    - ⏱️ **Auto-Cancel**: Unpaid orders are cancelled after 5 minutes and stock is released.
    - 🧾 **Order Center**: Order list and details pages.
    - 🔔 **Pending Order Alert**: Homepage banner reminds users of unpaid orders.
    - 🔄 **Refund Requests**: Users can submit refund requests for admin review (supports client-side & server-side refund).
    - 💳 **Payment QR**: Admins can generate payment links/QR codes for direct payments without requiring a product.
- **Admin Console**:
    - 📊 **Sales Stats**: Today/week/month/total overview.
    - ⚠️ **Low Stock Alerts**: Configurable threshold and warnings.
    - 🧩 **Product Management**: Create/edit, enable/disable, reorder, purchase limits, hot tag, discount price.
    - 🏷️ **Category Management**: CRUD categories with icons and ordering.
    - 🗂️ **Card Inventory**: Bulk import (newline/comma) with de-duplication and delete unused card keys.
    - 🧯 **Stock Self-Heal**: Handles legacy `is_used = NULL` that can cause false out-of-stock, and backfills it to `false`.
    - 📦 **Total Stock Display**: Homepage shows "Available + Locked" stock to prevent perceived sell-outs.
    - 💳 **Orders & Refunds**: Pagination/search/filters, order detail, mark paid/delivered/cancel, client-mode refund + optional server proxy.
    - 🧹 **Order Cleanup**: Bulk select and bulk delete.
    - ⭐ **Review Management**: Search and delete reviews.
    - 📦 **Data Export**: Export orders/products/reviews/settings; full dump JSON + D1 SQL.
    - 📣 **Announcements**: Homepage announcement management.
    - 🏷️ **Store Name**: Editable in admin and reflected in header/title.
- **I18n & Theme**:
    - 🌐 **English/Chinese switcher**.
    - 🌓 **Light/Dark/System themes**.
    - ⏱️ **Auto Update (Upstream Sync)**: GitHub Actions workflow included for Fork users to auto-sync upstream changes and trigger Vercel deploy.


### 🆕 Workers Edition Exclusive Features

> The following features are available ONLY in the Cloudflare Workers version:

| Feature | Description |
|---------|-------------|
| 📱 **Telegram Notifications** | Real-time purchase/refund alerts to Telegram, supports English/Chinese, built-in setup wizard |
| 🗑️ **Bulk Card Delete** | Batch delete unused card keys with multi-select/select-all |
| 🔄 **Shared Card Products** | Unlimited stock products that don't deduct inventory (for shared accounts, tutorials, etc.) |
| 📝 **Store Description (SEO)** | Custom site description |
| 🖼️ **Store Logo** | Custom site Logo and Favicon |
| 📜 **Custom Footer** | Custom site footer content |
| 🎨 **Theme Colors** | 7 theme colors available (Purple/Blue/Cyan/Green/Orange/Pink/Red) |
| 🤖 **Noindex Support** | Option to set 'noindex' to prevent search engine indexing |
| 👤 **User Profile** | Points overview, order stats, order history |
| 📧 **Email Notifications** | Automatic order completion emails (via Resend) |
| 📱 **Mobile Navigation** | Optimized bottom navigation bar for mobile |

## 🚀 Deployment Guide


### ⭐ Recommended: Cloudflare Workers

Higher free tier, faster global access, no cold start delay.

👉 **[View Full Deployment Guide → `_workers_next/README.md`](./_workers_next/README.md)**

### Alternative: Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fchatgptuk%2Fldc-shop&env=OAUTH_CLIENT_ID,OAUTH_CLIENT_SECRET,MERCHANT_ID,MERCHANT_KEY,ADMIN_USERS,NEXT_PUBLIC_APP_URL&envDescription=Required%20Environment%20Variables&project-name=ldc-shop&repository-name=ldc-shop&stores=%5B%7B%22type%22%3A%22postgres%22%7D%5D)

Click the button above for one-click deploy to Vercel with auto-provisioned Postgres database.

## 💡 Recommendation: Custom Domain

While the system supports active order status querying, for the best user experience (instant payment status updates), we still **recommend** binding a custom domain (e.g., `store.yourdomain.com`).

The shared `vercel.app` domain is sometimes flagged by firewalls or payment gateways, which might delay or block payment callbacks. Using a custom domain avoids these issues.

## 🐳 Docker Deployment (Docker Compose)

> ⚠️ **Experimental**: Docker deployment has not been fully tested and may have unknown issues. **We recommend using Vercel deployment** for better stability.

If you have your own server (VPS/NAS), you can deploy simply with Docker:

1.  Clone the repository:
    ```bash
    git clone https://github.com/chatgptuk/ldc-shop.git
    cd ldc-shop
    ```
2.  Edit `docker-compose.yml` environment variables:
    - This file starts a local PostgreSQL database by default.
    - **Crucial**: Replace `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `MERCHANT_ID`, `MERCHANT_KEY` with your actual credentials.
3.  Start the service:
    ```bash
    docker-compose up -d
    ```
4.  Visit `http://localhost:3000`.
    - Database data is persisted in the local `./postgres-data` folder.

## 🔄 How to Enable Auto Update

If you forked this project, you can enable GitHub Actions to automatically sync the latest code from upstream (triggering a Vercel redeploy):

1.  Go to your GitHub repository page.
2.  Click the **Actions** tab.
3.  Select **Upstream Sync** from the left sidebar.
4.  Click the **Enable workflow** button.
5.  (Optional) Click **Run workflow** to test it manually.

Once enabled, the script will check for updates from `chatgptuk/ldc-shop:main` daily and merge them into your repository.


## ⚙️ Configuration Guide

The following environment variables are required.

> **⚠️ NOTE**: 
> The following configuration uses `store.chatgpt.org.uk` as an example. **Please replace it with your ACTUAL domain when deploying!**

### 1. Linux DO Connect (OIDC)
Go to [connect.linux.do](https://connect.linux.do) to create/configure:

*   **App Name**: `LDC Store Next` (or any name)
*   **App Homepage**: `https://store.chatgpt.org.uk`
*   **App Description**: `LDC Store Next`
*   **Callback URL**: `https://store.chatgpt.org.uk/api/auth/callback/linuxdo`

Get **Client ID** and **Client Secret**, and fill them into Vercel Environment Variables as `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`.

### 2. EPay (Linux DO Credit)
Go to [credit.linux.do](https://credit.linux.do) to create/configure:

*   **App Name**: `LDC Store Next` (or any name)
*   **App Address**: `https://store.chatgpt.org.uk`
*   **Callback URI**: `https://store.chatgpt.org.uk/callback`
*   **Notify URL**: `https://store.chatgpt.org.uk/api/notify`

Get **Client ID** and **Client Secret**, and fill them into Vercel Environment Variables as `MERCHANT_ID` and `MERCHANT_KEY`.

### 3. Other Variables
*   **ADMIN_USERS**: Admin usernames, comma separated (e.g., `chatgpt,admin`).
*   **NEXT_PUBLIC_APP_URL**: Your full app URL (e.g., `https://store.chatgpt.org.uk`).

## 🛠️ Local Development

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Link Vercel Project (for Env Vars & DB):
    ```bash
    vercel link
    vercel env pull .env.development.local
    ```
4.  Run migrations:
    ```bash
    npx drizzle-kit push
    ```
5.  Start dev server:
    ```bash
    npm run dev
    ```

## 📄 License
MIT
