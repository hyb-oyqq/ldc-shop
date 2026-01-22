import { db } from "./index";
import { products, cards, orders, settings, reviews, loginUsers, categories, userNotifications, wishlistItems, wishlistVotes } from "./schema";
import { eq, sql, desc, and, asc, gte, or, inArray } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { cache } from "react";

// Database initialization state
let dbInitialized = false;
let loginUsersSchemaReady = false;
let wishlistTablesReady = false;
const CURRENT_SCHEMA_VERSION = 9;

async function safeAddColumn(table: string, column: string, definition: string) {
    try {
        await db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`));
    } catch (e: any) {
        // Ignore "duplicate column" errors in SQLite
        // Use JSON.stringify AND String(e) to be safe across different environments
        const errorString = (JSON.stringify(e) + String(e)).toLowerCase();
        if (!errorString.includes('duplicate column')) throw e;
    }
}

async function ensureIndexes() {
    // ... existing index logic unchanged ...
    const indexStatements = [
        `CREATE INDEX IF NOT EXISTS products_active_sort_idx ON products(is_active, sort_order, created_at)`,
        `CREATE INDEX IF NOT EXISTS products_stock_count_idx ON products(stock_count)`,
        `CREATE INDEX IF NOT EXISTS products_sold_count_idx ON products(sold_count)`,
        `CREATE INDEX IF NOT EXISTS cards_product_used_reserved_idx ON cards(product_id, is_used, reserved_at)`,
        `CREATE INDEX IF NOT EXISTS cards_reserved_order_idx ON cards(reserved_order_id)`,
        `CREATE INDEX IF NOT EXISTS orders_status_paid_at_idx ON orders(status, paid_at)`,
        `CREATE INDEX IF NOT EXISTS orders_status_created_at_idx ON orders(status, created_at)`,
        `CREATE INDEX IF NOT EXISTS orders_user_status_created_at_idx ON orders(user_id, status, created_at)`,
        `CREATE INDEX IF NOT EXISTS orders_product_status_idx ON orders(product_id, status)`,
        `CREATE INDEX IF NOT EXISTS reviews_product_created_at_idx ON reviews(product_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS refund_requests_order_id_idx ON refund_requests(order_id)`,
        `CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx ON user_notifications(user_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS user_notifications_user_read_idx ON user_notifications(user_id, is_read, created_at)`,
        `CREATE INDEX IF NOT EXISTS admin_messages_created_idx ON admin_messages(created_at)`,
        `CREATE INDEX IF NOT EXISTS user_messages_read_created_idx ON user_messages(is_read, created_at)`,
        `CREATE INDEX IF NOT EXISTS user_messages_user_created_idx ON user_messages(user_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS broadcast_messages_created_idx ON broadcast_messages(created_at)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS broadcast_reads_message_user_uq ON broadcast_reads(message_id, user_id)`,
        `CREATE INDEX IF NOT EXISTS broadcast_reads_user_idx ON broadcast_reads(user_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS wishlist_items_created_idx ON wishlist_items(created_at)`,
        `CREATE INDEX IF NOT EXISTS wishlist_votes_item_idx ON wishlist_votes(item_id, created_at)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS wishlist_votes_item_user_uq ON wishlist_votes(item_id, user_id)`,
    ];

    // ... rest of ensureIndexes ...
    try {
        await db.run(sql`
            DELETE FROM broadcast_reads 
            WHERE id NOT IN (
                SELECT MIN(id) 
                FROM broadcast_reads 
                GROUP BY message_id, user_id
            )
        `);
    } catch {
    }

    for (const statement of indexStatements) {
        try {
            await db.run(sql.raw(statement));
        } catch (e: any) {
            const errorString = (JSON.stringify(e) + String(e) + (e?.message || '')).toLowerCase();
            if (errorString.includes('no such table') || errorString.includes('does not exist')) {
                continue;
            }
            if (errorString.includes('already exists') || errorString.includes('constraint failed')) {
                continue;
            }
            throw e;
        }
    }
}

// Auto-initialize database on first query
async function ensureDatabaseInitialized() {
    if (dbInitialized) return;

    try {
        // OPTIMIZATION: Check schema version first to avoid heavy DDL checks
        try {
            const version = await getSetting('schema_version');
            if (version === String(CURRENT_SCHEMA_VERSION)) {
                dbInitialized = true;
                return;
            }
        } catch (e) {
            // Settings table likely doesn't exist, proceed to full checks
        }

        // Quick check if products table exists
        await db.run(sql`SELECT 1 FROM products LIMIT 1`);

        // IMPORTANT: Even if table exists, ensure columns exist!
        await ensureProductsColumns();
        await ensureLoginUsersTable();
        await ensureLoginUsersColumns(); // Add this call
        loginUsersSchemaReady = true;
        await ensureUserNotificationsTable();
        await ensureAdminMessagesTable();
        await ensureUserMessagesTable();
        await ensureBroadcastTables();
        await ensureWishlistTables();
        await migrateTimestampColumnsToMs();
        await ensureIndexes();
        await backfillProductAggregates();

        // Update schema version
        await setSetting('schema_version', String(CURRENT_SCHEMA_VERSION));

        dbInitialized = true;
        return;
    } catch {
        // Table doesn't exist, initialize database
    }
    // ...


    console.log("First run detected, initializing database...");

    await db.run(sql`
        -- Products table
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            price TEXT NOT NULL,
            compare_at_price TEXT,
            category TEXT,
            image TEXT,
            is_hot INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            is_shared INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            purchase_limit INTEGER,
            purchase_warning TEXT,
            stock_count INTEGER DEFAULT 0,
            locked_count INTEGER DEFAULT 0,
            sold_count INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        
        -- Cards (stock) table
        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            card_key TEXT NOT NULL,
            is_used INTEGER DEFAULT 0,
            reserved_order_id TEXT,
            reserved_at INTEGER,
            used_at INTEGER,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        
        -- Orders table
        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            amount TEXT NOT NULL,
            email TEXT,
            payee TEXT,
            status TEXT DEFAULT 'pending',
            trade_no TEXT,
            card_key TEXT,
            paid_at INTEGER,
            delivered_at INTEGER,
            user_id TEXT,
            username TEXT,
            points_used INTEGER DEFAULT 0,
            quantity INTEGER DEFAULT 1,
            current_payment_id TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        
        -- Login users table
        CREATE TABLE IF NOT EXISTS login_users (
            user_id TEXT PRIMARY KEY,
            username TEXT,
            points INTEGER DEFAULT 0,
            is_blocked INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch() * 1000),
            last_login_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        
        -- Daily checkins table
        CREATE TABLE IF NOT EXISTS daily_checkins_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        
        -- Settings table
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        
        -- Categories table
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch() * 1000),
            updated_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS categories_name_uq ON categories(name);
        
        -- Reviews table
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            order_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            rating INTEGER NOT NULL,
            comment TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        
        -- Refund requests table
        CREATE TABLE IF NOT EXISTS refund_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            user_id TEXT,
            username TEXT,
            reason TEXT,
            status TEXT DEFAULT 'pending',
            admin_username TEXT,
            admin_note TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000),
            updated_at INTEGER DEFAULT (unixepoch() * 1000),
            processed_at INTEGER
        );

        -- User notifications table
        CREATE TABLE IF NOT EXISTS user_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            title_key TEXT NOT NULL,
            content_key TEXT NOT NULL,
            data TEXT,
            is_read INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );

        -- Admin messages table
        CREATE TABLE IF NOT EXISTS admin_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_type TEXT NOT NULL,
            target_value TEXT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            sender TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );

        -- User messages table
        CREATE TABLE IF NOT EXISTS user_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            username TEXT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );

        -- Broadcast messages
        CREATE TABLE IF NOT EXISTS broadcast_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            sender TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );

        -- Broadcast read receipts
        CREATE TABLE IF NOT EXISTS broadcast_reads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL REFERENCES broadcast_messages(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );

        -- Wishlist items
        CREATE TABLE IF NOT EXISTS wishlist_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            user_id TEXT,
            username TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );

        -- Wishlist votes
        CREATE TABLE IF NOT EXISTS wishlist_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS wishlist_votes_item_user_uq ON wishlist_votes(item_id, user_id);
    `);

    await migrateTimestampColumnsToMs();
    await ensureIndexes();
    await backfillProductAggregates();

    // Set initial schema version
    try {
        await setSetting('schema_version', String(CURRENT_SCHEMA_VERSION));
    } catch {
        // If setSetting failed (e.g. settings table issue), try to ensure it exists and retry
        await ensureSettingsTable();
        await setSetting('schema_version', String(CURRENT_SCHEMA_VERSION));
    }

    dbInitialized = true;
    console.log("Database initialized successfully");
}

async function ensureProductsColumns() {
    await safeAddColumn('products', 'compare_at_price', 'TEXT');
    await safeAddColumn('products', 'is_hot', 'INTEGER DEFAULT 0');
    await safeAddColumn('products', 'purchase_warning', 'TEXT');
    await safeAddColumn('products', 'is_shared', 'INTEGER DEFAULT 0');
    await safeAddColumn('products', 'stock_count', 'INTEGER DEFAULT 0');
    await safeAddColumn('products', 'locked_count', 'INTEGER DEFAULT 0');
    await safeAddColumn('products', 'sold_count', 'INTEGER DEFAULT 0');
    await safeAddColumn('products', 'rating', 'REAL DEFAULT 0');
    await safeAddColumn('products', 'review_count', 'INTEGER DEFAULT 0');
}

async function ensureOrdersColumns() {
    await safeAddColumn('orders', 'points_used', 'INTEGER DEFAULT 0 NOT NULL');
    await safeAddColumn('orders', 'current_payment_id', 'TEXT');
    await safeAddColumn('orders', 'payee', 'TEXT');
}

async function ensureLoginUsersColumns() {
    await safeAddColumn('login_users', 'last_checkin_at', 'INTEGER');
    await safeAddColumn('login_users', 'consecutive_days', 'INTEGER DEFAULT 0');
}

export async function ensureLoginUsersSchema() {
    if (loginUsersSchemaReady) return;
    await ensureLoginUsersTable();
    await ensureLoginUsersColumns();
    await safeAddColumn('login_users', 'email', 'TEXT');
    await safeAddColumn('login_users', 'points', 'INTEGER DEFAULT 0 NOT NULL');
    await safeAddColumn('login_users', 'is_blocked', 'INTEGER DEFAULT 0');
    loginUsersSchemaReady = true;
}

async function isProductAggregatesBackfilled(): Promise<boolean> {
    try {
        const result = await db.select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, 'product_aggregates_backfilled_v2'));
        return result[0]?.value === '1';
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureSettingsTable();
            return false;
        }
        throw error;
    }
}

async function markProductAggregatesBackfilled() {
    await db.insert(settings).values({
        key: 'product_aggregates_backfilled_v2',
        value: '1',
        updatedAt: new Date()
    }).onConflictDoUpdate({
        target: settings.key,
        set: { value: '1', updatedAt: new Date() }
    });
}

export async function recalcProductAggregates(productId: string) {
    const pid = (productId || '').trim();
    if (!pid) return;

    try {
        await ensureProductsColumns();
    } catch (error: any) {
        if (isMissingTableOrColumn(error)) return;
        throw error;
    }

    const product = await db.query.products.findFirst({
        where: eq(products.id, pid),
        columns: { isShared: true }
    });
    if (!product) return;

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    let unusedCount = 0;
    let availableCount = 0;
    let lockedCount = 0;

    try {
        const cardRows = await db.select({
            unused: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(${cards.isUsed}, 0) = 0 THEN 1 ELSE 0 END), 0)`,
            available: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(${cards.isUsed}, 0) = 0 AND (${cards.reservedAt} IS NULL OR ${cards.reservedAt} < ${fiveMinutesAgo}) THEN 1 ELSE 0 END), 0)`,
            locked: sql<number>`COALESCE(SUM(CASE WHEN COALESCE(${cards.isUsed}, 0) = 0 AND ${cards.reservedAt} IS NOT NULL AND ${cards.reservedAt} >= ${fiveMinutesAgo} THEN 1 ELSE 0 END), 0)`
        })
            .from(cards)
            .where(eq(cards.productId, pid));

        const row = cardRows[0];
        unusedCount = Number(row?.unused || 0);
        availableCount = Number(row?.available || 0);
        lockedCount = Number(row?.locked || 0);
    } catch (error: any) {
        if (!isMissingTableOrColumn(error)) throw error;
    }

    let soldCount = 0;
    try {
        const soldRows = await db.select({
            total: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} IN ('paid', 'delivered') THEN ${orders.quantity} ELSE 0 END), 0)`
        })
            .from(orders)
            .where(eq(orders.productId, pid));
        soldCount = Number(soldRows[0]?.total || 0);
    } catch (error: any) {
        if (!isMissingTableOrColumn(error)) throw error;
    }

    let rating = 0;
    let reviewCount = 0;
    try {
        const reviewRows = await db.select({
            avg: sql<number>`COALESCE(AVG(${reviews.rating}), 0)`,
            count: sql<number>`COUNT(*)`
        })
            .from(reviews)
            .where(eq(reviews.productId, pid));
        rating = Number(reviewRows[0]?.avg || 0);
        reviewCount = Number(reviewRows[0]?.count || 0);
    } catch (error: any) {
        if (!isMissingTableOrColumn(error)) throw error;
    }

    const stockCount = product.isShared ? (unusedCount > 0 ? 999999 : 0) : availableCount;

    await db.update(products)
        .set({
            stockCount,
            lockedCount,
            soldCount,
            rating,
            reviewCount
        })
        .where(eq(products.id, pid));
}

export async function recalcProductAggregatesForMany(productIds: string[]) {
    const ids = Array.from(new Set((productIds || []).map((id) => String(id).trim()).filter(Boolean)));
    if (!ids.length) return;
    for (const id of ids) {
        try {
            await recalcProductAggregates(id);
        } catch {
            // best effort
        }
    }
}

async function backfillProductAggregates() {
    const already = await isProductAggregatesBackfilled();
    if (already) return;

    try {
        await ensureProductsColumns();
        const rows = await db.select({ id: products.id }).from(products);
        for (const row of rows) {
            await recalcProductAggregates(row.id);
        }
        await markProductAggregatesBackfilled();
    } catch (error: any) {
        if (!isMissingTableOrColumn(error)) throw error;
    }
}

async function withProductColumnFallback<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn()
    } catch (error: any) {
        // Use more robust string conversion for error checking
        const errorString = (JSON.stringify(error) + String(error) + (error?.message || '')).toLowerCase();

        // Check for missing column errors (PostgreSQL: 42703, SQLite/D1: no such column, D1_COLUMN_NOTFOUND)
        if (errorString.includes('42703') || errorString.includes('no such column') || errorString.includes('column not found') || errorString.includes('d1_column_notfound')) {
            console.log("Detected missing column error, attempting remediation...");
            await ensureProductsColumns();
            return await fn();
        }
        throw error;
    }
}

export async function withOrderColumnFallback<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn()
    } catch (error: any) {
        if (isMissingTableOrColumn(error)) {
            await ensureOrdersColumns()
            return await fn()
        }
        throw error
    }
}

export async function getProducts() {
    return await withProductColumnFallback(async () => {
        return await db.select({
            id: products.id,
            name: products.name,
            description: products.description,
            price: products.price,
            compareAtPrice: products.compareAtPrice,
            image: products.image,
            category: products.category,
            isHot: products.isHot,
            isActive: products.isActive,
            isShared: products.isShared,
            sortOrder: products.sortOrder,
            purchaseLimit: products.purchaseLimit,
            stock: sql<number>`COALESCE(${products.stockCount}, 0)`,
            locked: sql<number>`COALESCE(${products.lockedCount}, 0)`,
            sold: sql<number>`COALESCE(${products.soldCount}, 0)`
        })
            .from(products)
            .orderBy(asc(products.sortOrder), desc(products.createdAt));
    })
}

// Get only active products (for home page)
export async function getActiveProducts() {
    // Auto-initialize database on first access
    await ensureDatabaseInitialized();

    return await withProductColumnFallback(async () => {
        return await db.select({
            id: products.id,
            name: products.name,
            description: products.description,
            price: products.price,
            compareAtPrice: products.compareAtPrice,
            image: products.image,
            category: products.category,
            isHot: products.isHot,
            isShared: products.isShared,
            purchaseLimit: products.purchaseLimit,
            stock: sql<number>`COALESCE(${products.stockCount}, 0)`,
            locked: sql<number>`COALESCE(${products.lockedCount}, 0)`,
            sold: sql<number>`COALESCE(${products.soldCount}, 0)`,
            rating: sql<number>`COALESCE(${products.rating}, 0)`,
            reviewCount: sql<number>`COALESCE(${products.reviewCount}, 0)`
        })
            .from(products)
            .where(eq(products.isActive, true))
            .orderBy(asc(products.sortOrder), desc(products.createdAt));
    })
}

export async function getWishlistItems(userId: string | null, limit = 10) {
    await ensureDatabaseInitialized();

    try {
        const result: any = await db.run(sql`
            SELECT
                wi.id AS id,
                wi.title AS title,
                wi.description AS description,
                wi.username AS username,
                wi.created_at AS created_at,
                COUNT(wv.id) AS votes,
                SUM(CASE WHEN wv.user_id = ${userId} THEN 1 ELSE 0 END) AS voted
            FROM wishlist_items wi
            LEFT JOIN wishlist_votes wv ON wv.item_id = wi.id
            GROUP BY wi.id
            ORDER BY votes DESC, wi.created_at DESC
            LIMIT ${limit}
        `);

        const rows = result?.results || result?.rows || [];
        return rows.map((row: any) => ({
            id: Number(row.id),
            title: row.title,
            description: row.description,
            username: row.username,
            createdAt: Number(row.created_at ?? row.createdAt ?? 0),
            votes: Number(row.votes || 0),
            voted: Number(row.voted || 0) > 0,
        }));
    } catch (error: any) {
        if (isMissingTableOrColumn(error)) {
            await ensureWishlistTables();
            // Retry once
            try {
                const result: any = await db.run(sql`
                    SELECT
                        wi.id AS id,
                        wi.title AS title,
                        wi.description AS description,
                        wi.username AS username,
                        wi.created_at AS created_at,
                        COUNT(wv.id) AS votes,
                        SUM(CASE WHEN wv.user_id = ${userId} THEN 1 ELSE 0 END) AS voted
                    FROM wishlist_items wi
                    LEFT JOIN wishlist_votes wv ON wv.item_id = wi.id
                    GROUP BY wi.id
                    ORDER BY votes DESC, wi.created_at DESC
                    LIMIT ${limit}
                `);
                const rows = result?.results || result?.rows || [];
                return rows.map((row: any) => ({
                    id: Number(row.id),
                    title: row.title,
                    description: row.description,
                    username: row.username,
                    createdAt: Number(row.created_at ?? row.createdAt ?? 0),
                    votes: Number(row.votes || 0),
                    voted: Number(row.voted || 0) > 0,
                }));
            } catch (retryError) {
                console.error('getWishlistItems retry failed:', retryError);
                return [];
            }
        }
        console.error('getWishlistItems failed:', error);
        return [];
    }
}

export async function getProduct(id: string) {
    return await withProductColumnFallback(async () => {
        const result = await db.select({
            id: products.id,
            name: products.name,
            description: products.description,
            price: products.price,
            compareAtPrice: products.compareAtPrice,
            image: products.image,
            category: products.category,
            isHot: products.isHot,
            isActive: products.isActive,
            isShared: products.isShared,
            purchaseLimit: products.purchaseLimit,
            purchaseWarning: products.purchaseWarning,
            stock: sql<number>`COALESCE(${products.stockCount}, 0)`,
            locked: sql<number>`COALESCE(${products.lockedCount}, 0)`,
            rating: sql<number>`COALESCE(${products.rating}, 0)`,
            reviewCount: sql<number>`COALESCE(${products.reviewCount}, 0)`
        })
            .from(products)
            .where(eq(products.id, id))
            ;

        // Return null if product doesn't exist or is inactive
        const product = result[0];
        if (!product || product.isActive === false) {
            return null;
        }
        return product;
    })
}

// Get product for admin (includes inactive products)
export async function getProductForAdmin(id: string) {
    return await withProductColumnFallback(async () => {
        const result = await db.select({
            id: products.id,
            name: products.name,
            description: products.description,
            price: products.price,
            compareAtPrice: products.compareAtPrice,
            image: products.image,
            category: products.category,
            isHot: products.isHot,
            isActive: products.isActive,
            isShared: products.isShared,
            purchaseLimit: products.purchaseLimit,
            purchaseWarning: products.purchaseWarning,
        })
            .from(products)
            .where(eq(products.id, id));

        return result[0] || null;
    });
}

// Dashboard Stats
export async function getDashboardStats() {
    return await withOrderColumnFallback(async () => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const todayStartMs = todayStart.getTime();
        const weekStartMs = weekStart.getTime();
        const monthStartMs = monthStart.getTime();
        const stats = await db.select({
            totalCount: sql<number>`count(*)`,
            totalRevenue: sql<number>`COALESCE(sum(CAST(${orders.amount} AS REAL)), 0)`,
            todayCount: sql<number>`COALESCE(sum(CASE WHEN ${orders.paidAt} >= ${todayStartMs} THEN 1 ELSE 0 END), 0)`,
            todayRevenue: sql<number>`COALESCE(sum(CASE WHEN ${orders.paidAt} >= ${todayStartMs} THEN CAST(${orders.amount} AS REAL) ELSE 0 END), 0)`,
            weekCount: sql<number>`COALESCE(sum(CASE WHEN ${orders.paidAt} >= ${weekStartMs} THEN 1 ELSE 0 END), 0)`,
            weekRevenue: sql<number>`COALESCE(sum(CASE WHEN ${orders.paidAt} >= ${weekStartMs} THEN CAST(${orders.amount} AS REAL) ELSE 0 END), 0)`,
            monthCount: sql<number>`COALESCE(sum(CASE WHEN ${orders.paidAt} >= ${monthStartMs} THEN 1 ELSE 0 END), 0)`,
            monthRevenue: sql<number>`COALESCE(sum(CASE WHEN ${orders.paidAt} >= ${monthStartMs} THEN CAST(${orders.amount} AS REAL) ELSE 0 END), 0)`,
        })
            .from(orders)
            .where(eq(orders.status, 'delivered'));

        const row = stats[0] || {
            totalCount: 0,
            totalRevenue: 0,
            todayCount: 0,
            todayRevenue: 0,
            weekCount: 0,
            weekRevenue: 0,
            monthCount: 0,
            monthRevenue: 0,
        };

        return {
            today: { count: row.todayCount || 0, revenue: row.todayRevenue || 0 },
            week: { count: row.weekCount || 0, revenue: row.weekRevenue || 0 },
            month: { count: row.monthCount || 0, revenue: row.monthRevenue || 0 },
            total: { count: row.totalCount || 0, revenue: row.totalRevenue || 0 }
        };
    })
}

export async function getRecentOrders(limit: number = 10) {
    return await withOrderColumnFallback(async () => {
        return await db.query.orders.findMany({
            orderBy: [desc(normalizeTimestampMs(orders.createdAt))],
            limit
        })
    })
}

// Settings
export const getSetting = cache(async (key: string): Promise<string | null> => {
    const result = await db.select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key));
    return result[0]?.value ?? null;
});

export const getAllSettings = cache(async (): Promise<Record<string, string>> => {
    try {
        const rows = await db.select({ key: settings.key, value: settings.value }).from(settings);
        return rows.reduce((acc, row) => {
            acc[row.key] = row.value || '';
            return acc;
        }, {} as Record<string, string>);
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureSettingsTable();
            return {};
        }
        throw error;
    }
});

export async function setSetting(key: string, value: string): Promise<void> {
    await db.insert(settings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
            target: settings.key,
            set: { value, updatedAt: new Date() }
        });
}

// Categories (best-effort; table created on demand)
async function ensureCategoriesTable() {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS categories(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch() * 1000),
        updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
        CREATE UNIQUE INDEX IF NOT EXISTS categories_name_uq ON categories(name);
    `)
}

export async function getCategories(): Promise<Array<{ id: number; name: string; icon: string | null; sortOrder: number }>> {
    try {
        const rows = await db.select({
            id: categories.id,
            name: categories.name,
            icon: categories.icon,
            sortOrder: sql<number>`COALESCE(${categories.sortOrder}, 0)`,
        }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name))
        return rows
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureCategoriesTable()
            return []
        }
        throw error
    }
}

export async function createUserNotification(params: {
    userId: string | null | undefined
    type: string
    titleKey: string
    contentKey: string
    data?: Record<string, any> | null
}) {
    if (!params.userId) return
    await ensureDatabaseInitialized()
    try {
        await db.insert(userNotifications).values({
            userId: params.userId,
            type: params.type,
            titleKey: params.titleKey,
            contentKey: params.contentKey,
            data: params.data ? JSON.stringify(params.data) : null,
            isRead: false,
            createdAt: new Date()
        })
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureUserNotificationsTable()
            await db.insert(userNotifications).values({
                userId: params.userId,
                type: params.type,
                titleKey: params.titleKey,
                contentKey: params.contentKey,
                data: params.data ? JSON.stringify(params.data) : null,
                isRead: false,
                createdAt: new Date()
            })
            return
        }
        throw error
    }
}

export async function getUserNotifications(userId: string, limit: number = 20) {
    await ensureDatabaseInitialized()
    try {
        return await db.select({
            id: userNotifications.id,
            userId: userNotifications.userId,
            type: userNotifications.type,
            titleKey: userNotifications.titleKey,
            contentKey: userNotifications.contentKey,
            data: userNotifications.data,
            isRead: userNotifications.isRead,
            createdAt: userNotifications.createdAt
        })
            .from(userNotifications)
            .where(eq(userNotifications.userId, userId))
            .orderBy(desc(normalizeTimestampMs(userNotifications.createdAt)))
            .limit(limit)
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureUserNotificationsTable()
            return []
        }
        throw error
    }
}

export async function markAllUserNotificationsRead(userId: string) {
    await ensureDatabaseInitialized()
    try {
        await db.update(userNotifications)
            .set({ isRead: true })
            .where(eq(userNotifications.userId, userId))
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureUserNotificationsTable()
            return
        }
        throw error
    }
}

export async function getUserUnreadNotificationCount(userId: string) {
    await ensureDatabaseInitialized()
    try {
        const rows = await db.select({
            count: sql<number>`count(*)`
        })
            .from(userNotifications)
            .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)))
        return Number(rows[0]?.count || 0)
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureUserNotificationsTable()
            return 0
        }
        throw error
    }
}

export async function markUserNotificationRead(userId: string, id: number) {
    await ensureDatabaseInitialized()
    try {
        await db.update(userNotifications)
            .set({ isRead: true })
            .where(and(eq(userNotifications.userId, userId), eq(userNotifications.id, id)))
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureUserNotificationsTable()
            return
        }
        throw error
    }
}

export async function clearUserNotifications(userId: string) {
    await ensureDatabaseInitialized()
    try {
        await db.delete(userNotifications)
            .where(eq(userNotifications.userId, userId))
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureUserNotificationsTable()
            return
        }
        throw error
    }
}

export async function searchActiveProducts(params: {
    q?: string
    category?: string
    sort?: string
    page?: number
    pageSize?: number
}) {
    const q = (params.q || '').trim()
    const category = (params.category || '').trim()
    const sort = (params.sort || 'default').trim()
    const page = params.page && params.page > 0 ? params.page : 1
    const pageSize = Math.min(params.pageSize && params.pageSize > 0 ? params.pageSize : 24, 60)
    const offset = (page - 1) * pageSize

    const whereParts: any[] = [eq(products.isActive, true)]
    if (category && category !== 'all') whereParts.push(eq(products.category, category))
    if (q) {
        const like = `%${q}%`
        whereParts.push(or(
            sql`${products.name} LIKE ${like}`,
            sql`COALESCE(${products.description}, '') LIKE ${like}`
        ))
    }
    const whereExpr = and(...whereParts)

    const orderByParts: any[] = []
    switch (sort) {
        case 'priceAsc':
            orderByParts.push(asc(products.price))
            break
        case 'priceDesc':
            orderByParts.push(desc(products.price))
            break
        case 'stockDesc':
            orderByParts.push(desc(sql<number>`COALESCE(${products.stockCount}, 0) + COALESCE(${products.lockedCount}, 0)`))
            break
        case 'soldDesc':
            orderByParts.push(desc(sql<number>`COALESCE(${products.soldCount}, 0)`))
            break
        case 'hot':
            orderByParts.push(desc(sql<number>`case when ${products.isHot} = 1 then 1 else 0 end`))
            orderByParts.push(asc(products.sortOrder), desc(products.createdAt))
            break
        default:
            orderByParts.push(asc(products.sortOrder), desc(products.createdAt))
            break
    }

    const [items, totalRes] = await withProductColumnFallback(async () => {
        const rowsPromise = db.select({
            id: products.id,
            name: products.name,
            description: products.description,
            price: products.price,
            compareAtPrice: products.compareAtPrice,
            image: products.image,
            category: products.category,
            isHot: products.isHot,
            purchaseLimit: products.purchaseLimit,
            stock: sql<number>`COALESCE(${products.stockCount}, 0)`,
            locked: sql<number>`COALESCE(${products.lockedCount}, 0)`,
            sold: sql<number>`COALESCE(${products.soldCount}, 0)`,
            rating: sql<number>`COALESCE(${products.rating}, 0)`,
            reviewCount: sql<number>`COALESCE(${products.reviewCount}, 0)`
        })
            .from(products)
            .where(whereExpr)
            .orderBy(...orderByParts)
            .limit(pageSize)
            .offset(offset)

        const countQuery = db.select({ count: sql<number>`count(*)` }).from(products).where(whereExpr)
        return Promise.all([rowsPromise, countQuery])
    })

    return {
        items,
        total: totalRes[0]?.count || 0,
        page,
        pageSize,
    }
}

export async function getActiveProductCategories(): Promise<string[]> {
    await ensureDatabaseInitialized();
    try {
        const rows = await db
            .select({ category: products.category })
            .from(products)
            .where(and(eq(products.isActive, true), sql`${products.category} IS NOT NULL`, sql`TRIM(${products.category}) <> ''`))
            .groupBy(products.category)
            .orderBy(asc(products.category));
        return rows.map((r) => r.category as string).filter(Boolean);
    } catch (error: any) {
        if (isMissingTable(error)) return [];
        throw error;
    }
}

// Reviews
export async function getProductReviews(productId: string) {
    return await db.select()
        .from(reviews)
        .where(eq(reviews.productId, productId))
        .orderBy(desc(reviews.createdAt));
}

export async function getProductRating(productId: string): Promise<{ average: number; count: number }> {
    const result = await db.select({
        avg: sql<number>`COALESCE(AVG(${reviews.rating}), 0)`,
        count: sql<number>`COUNT(*)`
    })
        .from(reviews)
        .where(eq(reviews.productId, productId));

    return {
        average: result[0]?.avg ?? 0,
        count: result[0]?.count ?? 0
    };
}

export async function getProductRatings(productIds: string[]): Promise<Map<string, { average: number; count: number }>> {
    const map = new Map<string, { average: number; count: number }>();
    if (!productIds.length) return map;

    try {
        const rows = await db.select({
            productId: reviews.productId,
            avg: sql<number>`COALESCE(AVG(${reviews.rating}), 0)`,
            count: sql<number>`COUNT(*)`
        })
            .from(reviews)
            .where(inArray(reviews.productId, productIds))
            .groupBy(reviews.productId);

        for (const row of rows) {
            map.set(row.productId, {
                average: row.avg ?? 0,
                count: row.count ?? 0
            });
        }
    } catch (error: any) {
        if (!isMissingTable(error)) throw error;
    }

    return map;
}

export async function createReview(data: {
    productId: string;
    orderId: string;
    userId: string;
    username: string;
    rating: number;
    comment?: string;
}) {
    const res = await db.insert(reviews).values({
        ...data,
        createdAt: new Date()
    }).returning();

    // Update product aggregates (rating/review_count)
    await recalcProductAggregates(data.productId);

    return res;
}

export async function canUserReview(userId: string, productId: string, username?: string): Promise<{ canReview: boolean; orderId?: string }> {
    try {
        // Check by userId first
        let deliveredOrders = await db.select({ orderId: orders.orderId })
            .from(orders)
            .where(and(
                eq(orders.userId, userId),
                eq(orders.productId, productId),
                eq(orders.status, 'delivered')
            ));

        // If no orders found by userId, try by username
        if (deliveredOrders.length === 0 && username) {
            deliveredOrders = await db.select({ orderId: orders.orderId })
                .from(orders)
                .where(and(
                    eq(orders.username, username),
                    eq(orders.productId, productId),
                    eq(orders.status, 'delivered')
                ));
        }

        if (deliveredOrders.length === 0) {
            return { canReview: false };
        }

        // Find the first order that hasn't been reviewed yet
        for (const order of deliveredOrders) {
            try {
                const existingReview = await db.select({ id: reviews.id })
                    .from(reviews)
                    .where(eq(reviews.orderId, order.orderId));

                if (existingReview.length === 0) {
                    // This order hasn't been reviewed yet
                    return { canReview: true, orderId: order.orderId };
                }
            } catch {
                // Reviews table might not exist, so user can review
                return { canReview: true, orderId: order.orderId };
            }
        }

        // All orders have been reviewed
        return { canReview: false };
    } catch (error) {
        console.error('canUserReview error:', error);
        return { canReview: false };
    }
}

export async function hasUserReviewedOrder(orderId: string): Promise<boolean> {
    const result = await db.select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.orderId, orderId));
    return result.length > 0;
}

function isMissingTable(error: any) {
    const errorString = JSON.stringify(error);
    return (
        error?.message?.includes('does not exist') ||
        error?.cause?.message?.includes('does not exist') ||
        errorString.includes('42P01') ||
        (errorString.includes('relation') && errorString.includes('does not exist'))
    );
}

function isMissingTableOrColumn(error: any) {
    const errorString = (JSON.stringify(error) + String(error) + (error?.message || '')).toLowerCase();
    return isMissingTable(error) || errorString.includes('42703') || errorString.includes('no such column') || errorString.includes('column not found') || errorString.includes('d1_column_notfound');
}

const TIMESTAMP_MS_THRESHOLD = 1_000_000_000_000;

export function normalizeTimestampMs(column: any) {
    return sql<number>`CASE WHEN ${column} < ${TIMESTAMP_MS_THRESHOLD} THEN ${column} * 1000 ELSE ${column} END`
}

async function migrateTimestampColumnsToMs() {
    const tableColumns = [
        { table: 'products', columns: ['created_at'] },
        { table: 'cards', columns: ['reserved_at', 'used_at', 'created_at'] },
        { table: 'orders', columns: ['paid_at', 'delivered_at', 'created_at'] },
        { table: 'login_users', columns: ['created_at', 'last_login_at'] },
        { table: 'daily_checkins_v2', columns: ['created_at'] },
        { table: 'settings', columns: ['updated_at'] },
        { table: 'reviews', columns: ['created_at'] },
        { table: 'categories', columns: ['created_at', 'updated_at'] },
        { table: 'refund_requests', columns: ['created_at', 'updated_at', 'processed_at'] },
        { table: 'user_notifications', columns: ['created_at'] },
        { table: 'admin_messages', columns: ['created_at'] },
        { table: 'user_messages', columns: ['created_at'] },
        { table: 'broadcast_messages', columns: ['created_at'] },
        { table: 'broadcast_reads', columns: ['created_at'] },
        { table: 'wishlist_items', columns: ['created_at'] },
        { table: 'wishlist_votes', columns: ['created_at'] },
    ];

    for (const { table, columns } of tableColumns) {
        for (const column of columns) {
            try {
                await db.run(sql.raw(
                    `UPDATE ${table} SET ${column} = ${column} * 1000 WHERE ${column} IS NOT NULL AND ${column} < ${TIMESTAMP_MS_THRESHOLD}`
                ));
            } catch (error: any) {
                if (!isMissingTableOrColumn(error)) throw error;
            }
        }
    }
}

async function ensureLoginUsersTable() {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS login_users(
        user_id TEXT PRIMARY KEY,
        username TEXT,
        email TEXT,
        points INTEGER DEFAULT 0 NOT NULL,
        is_blocked BOOLEAN DEFAULT FALSE,
        created_at INTEGER DEFAULT (unixepoch() * 1000),
        last_login_at INTEGER DEFAULT (unixepoch() * 1000)
    )
        `);
}

async function ensureSettingsTable() {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS settings(
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER DEFAULT (unixepoch() * 1000)
        )
        `);
}

async function ensureUserNotificationsTable() {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS user_notifications(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            title_key TEXT NOT NULL,
            content_key TEXT NOT NULL,
            data TEXT,
            is_read INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        )
    `);
}

async function ensureAdminMessagesTable() {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS admin_messages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_type TEXT NOT NULL,
            target_value TEXT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            sender TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        )
    `);
}

async function ensureUserMessagesTable() {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS user_messages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            username TEXT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        )
    `);
}

async function ensureBroadcastTables() {
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS broadcast_messages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            sender TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        CREATE TABLE IF NOT EXISTS broadcast_reads(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL REFERENCES broadcast_messages(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
    `);
}

async function ensureWishlistTables() {
    if (wishlistTablesReady) return;
    await db.run(sql`
        CREATE TABLE IF NOT EXISTS wishlist_items(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            user_id TEXT,
            username TEXT,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        CREATE TABLE IF NOT EXISTS wishlist_votes(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES login_users(user_id) ON DELETE CASCADE,
            created_at INTEGER DEFAULT (unixepoch() * 1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS wishlist_votes_item_user_uq ON wishlist_votes(item_id, user_id);
    `);

    await ensureWishlistColumns();
    wishlistTablesReady = true;
}

async function ensureWishlistColumns() {
    await safeAddColumn('wishlist_items', 'description', 'TEXT');
    await safeAddColumn('wishlist_items', 'user_id', 'TEXT');
    await safeAddColumn('wishlist_items', 'username', 'TEXT');
    await safeAddColumn('wishlist_items', 'created_at', 'INTEGER');
    await safeAddColumn('wishlist_votes', 'created_at', 'INTEGER');
}

async function isLoginUsersBackfilled(): Promise<boolean> {
    try {
        const result = await db.select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, 'login_users_backfilled'));
        return result[0]?.value === '1';
    } catch (error: any) {
        if (isMissingTable(error)) {
            await ensureSettingsTable();
            return false;
        }
        throw error;
    }
}

async function markLoginUsersBackfilled() {
    await db.insert(settings).values({
        key: 'login_users_backfilled',
        value: '1',
        updatedAt: new Date()
    }).onConflictDoUpdate({
        target: settings.key,
        set: { value: '1', updatedAt: new Date() }
    });
}

async function backfillLoginUsersFromOrdersAndReviews() {
    const alreadyBackfilled = await isLoginUsersBackfilled();
    if (alreadyBackfilled) return;

    await ensureLoginUsersTable();

    try {
        await db.run(sql`
            INSERT INTO login_users(user_id, username, created_at, last_login_at)
            SELECT user_id, MAX(username) AS username, (unixepoch() * 1000), (unixepoch() * 1000)
            FROM (
                SELECT user_id, username FROM orders WHERE user_id IS NOT NULL AND user_id <> ''
                UNION ALL
                SELECT user_id, username FROM reviews WHERE user_id IS NOT NULL AND user_id <> ''
            )
            GROUP BY user_id
            ON CONFLICT(user_id) DO NOTHING
        `);
    } catch (error: any) {
        if (isMissingTable(error)) return;
        throw error;
    }

    await markLoginUsersBackfilled();
}

export async function recordLoginUser(userId: string, username?: string | null, email?: string | null) {
    if (!userId) return;

    try {
        const result = await db.insert(loginUsers).values({
            userId,
            username: username || null,
            email: email || null,
            lastLoginAt: new Date()
        }).onConflictDoUpdate({
            target: loginUsers.userId,
            set: { username: username || null, lastLoginAt: new Date() }
        });
        if ((result as any)?.meta?.changes === 1) {
            try {
                revalidateTag('home:visitors');
            } catch {
                // best effort
            }
        }
        if (email) {
            try {
                await db.run(sql`UPDATE login_users SET email = ${email} WHERE user_id = ${userId} AND (email IS NULL OR email = '')`);
            } catch {
                // best effort
            }
        }
    } catch (error: any) {
        if (isMissingTable(error) || error?.code === '42703' || error?.message?.includes('column')) {
            await ensureLoginUsersSchema();

            const result = await db.insert(loginUsers).values({
                userId,
                username: username || null,
                email: email || null,
                lastLoginAt: new Date()
            }).onConflictDoUpdate({
                target: loginUsers.userId,
                set: { username: username || null, lastLoginAt: new Date() }
            });
            if ((result as any)?.meta?.changes === 1) {
                try {
                    revalidateTag('home:visitors');
                } catch {
                    // best effort
                }
            }
            if (email) {
                try {
                    await db.run(sql`UPDATE login_users SET email = ${email} WHERE user_id = ${userId} AND (email IS NULL OR email = '')`);
                } catch {
                    // best effort
                }
            }
            return;
        }
        console.error('recordLoginUser error:', error);
    }
}

export async function getLoginUserEmail(userId: string): Promise<string | null> {
    if (!userId) return null;
    try {
        const result = await db.select({ email: loginUsers.email })
            .from(loginUsers)
            .where(eq(loginUsers.userId, userId))
            .limit(1);
        return result[0]?.email ?? null;
    } catch (error: any) {
        if (isMissingTableOrColumn(error)) return null;
        throw error;
    }
}

export async function updateLoginUserEmail(userId: string, email: string | null) {
    if (!userId) return;
    try {
        await ensureLoginUsersTable();
        await safeAddColumn('login_users', 'email', 'TEXT');
        await db.update(loginUsers)
            .set({ email: email || null, lastLoginAt: new Date() })
            .where(eq(loginUsers.userId, userId));
    } catch (error: any) {
        if (isMissingTableOrColumn(error)) return;
        throw error;
    }
}

export async function getVisitorCount(): Promise<number> {
    try {
        await backfillLoginUsersFromOrdersAndReviews();
        const result = await db.select({ count: sql<number>`count(*)` })
            .from(loginUsers);
        return result[0]?.count || 0;
    } catch (error: any) {
        if (isMissingTable(error)) return 0;
        throw error;
    }
}

export async function cancelExpiredOrders(filters: { productId?: string; userId?: string; orderId?: string } = {}) {
    const productId = filters.productId ?? null;
    const userId = filters.userId ?? null;
    const orderId = filters.orderId ?? null;

    try {
        await ensureOrdersColumns()
    } catch (error: any) {
        if (!isMissingTableOrColumn(error)) throw error
    }

    try {
        // No transaction - D1 doesn't support SQL transactions
        const fiveMinutesAgoMs = Date.now() - 5 * 60 * 1000;
        const expired: any = await db.run(sql`
            UPDATE orders
            SET status = 'cancelled'
            WHERE status = 'pending'
              AND created_at < ${fiveMinutesAgoMs}
              AND (${productId} IS NULL OR product_id = ${productId})
              AND (${userId} IS NULL OR user_id = ${userId})
              AND (${orderId} IS NULL OR order_id = ${orderId})
            RETURNING order_id
        `);

        const orderIds = (expired.results || []).map((row: any) => row.order_id as string).filter(Boolean);
        if (!orderIds.length) return orderIds;

        try {
            await db.run(sql.raw(`ALTER TABLE cards ADD COLUMN reserved_order_id TEXT`));
        } catch { /* duplicate column */ }
        try {
            await db.run(sql.raw(`ALTER TABLE cards ADD COLUMN reserved_at INTEGER`));
        } catch { /* duplicate column */ }

        for (const expiredOrderId of orderIds) {
            try {
                await db.run(sql`
                    UPDATE cards
                    SET reserved_order_id = NULL, reserved_at = NULL
                    WHERE reserved_order_id = ${expiredOrderId} AND COALESCE(is_used, false) = false
                `);
            } catch (error: any) {
                if (!isMissingTableOrColumn(error)) throw error;
            }
        }

        try {
            const productRows = await db.select({ productId: orders.productId })
                .from(orders)
                .where(inArray(orders.orderId, orderIds));
            await recalcProductAggregatesForMany(productRows.map(r => r.productId));
        } catch {
            // best effort
        }
        try {
            revalidateTag('home:products');
        } catch {
            // best effort
        }

        return orderIds;
    } catch (error: any) {
        if (isMissingTableOrColumn(error)) return [];
        throw error;
    }
}

// Customer Management
export async function getUsers(page = 1, pageSize = 20, q = '') {
    const offset = (page - 1) * pageSize
    const search = q.trim()

    try {
        await backfillLoginUsersFromOrdersAndReviews();
        await ensureLoginUsersTable();

        let whereClause = undefined
        if (q) {
            const like = `%${q}%`
            whereClause = or(
                sql`${loginUsers.username} LIKE ${like}`,
                sql`${loginUsers.userId} LIKE ${like}`
            )
        }

        const itemsPromise = db.select({
            userId: loginUsers.userId,
            username: loginUsers.username,
            points: loginUsers.points,
            isBlocked: sql<boolean>`COALESCE(${loginUsers.isBlocked}, FALSE)`,
            lastLoginAt: loginUsers.lastLoginAt,
            createdAt: loginUsers.createdAt,
            orderCount: sql<number>`count(CASE WHEN ${orders.status} IN ('paid', 'delivered', 'refunded') THEN 1 END)`
        })
            .from(loginUsers)
            .leftJoin(orders, eq(loginUsers.userId, orders.userId))
            .where(whereClause)
            .groupBy(loginUsers.userId)
            .orderBy(desc(loginUsers.lastLoginAt))
            .limit(pageSize)
            .offset(offset)

        const countQuery = db.select({ count: sql<number>`count(DISTINCT ${loginUsers.userId})` })
            .from(loginUsers)
            .where(whereClause)

        const [items, totalRes] = await Promise.all([itemsPromise, countQuery])

        return {
            items,
            total: totalRes[0]?.count || 0,
            page,
            pageSize
        }
    } catch (error: any) {
        if (isMissingTable(error)) {
            return { items: [], total: 0, page, pageSize }
        }
        throw error
    }
}

export async function updateUserPoints(userId: string, points: number) {
    await ensureLoginUsersTable();
    await db.update(loginUsers)
        .set({ points })
        .where(eq(loginUsers.userId, userId));
}

export async function toggleUserBlock(userId: string, isBlocked: boolean) {
    await ensureLoginUsersTable();
    // Ensure column exists
    try {
        await db.run(sql.raw(`ALTER TABLE login_users ADD COLUMN is_blocked INTEGER DEFAULT 0`));
    } catch { /* duplicate column */ }

    await db.update(loginUsers)
        .set({ isBlocked })
        .where(eq(loginUsers.userId, userId));
}

export async function getUserPendingOrders(userId: string) {
    return await db.select({
        orderId: orders.orderId,
        createdAt: orders.createdAt,
        productName: orders.productName,
        amount: orders.amount
    })
        .from(orders)
        .where(and(
            eq(orders.userId, userId),
            eq(orders.status, 'pending')
        ))
        .orderBy(desc(normalizeTimestampMs(orders.createdAt)));
}
