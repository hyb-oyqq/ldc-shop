"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

async function executeStatement(statement: string) {
    if (!statement.trim()) return
    try {
        await db.run(sql.raw(statement))
    } catch (e) {
        console.error('Import Error:', e)
        throw new Error(`Failed to execute statement: ${statement.substring(0, 50)}... ${e instanceof Error ? e.message : String(e)}`)
    }
}

export async function importData(formData: FormData) {
    const file = formData.get('file') as File
    if (!file) {
        return { success: false, error: 'No file provided' }
    }

    try {
        const text = await file.text()
        const lines = text.split('\n')

        // Comprehensive Column Mapping (CamelCase -> snake_case) for Vercel exports
        // This covers known differences between Vercel export (which uses property names) and D1 schema
        const columnMap: Record<string, string> = {
            // Products
            compareAtPrice: 'compare_at_price',
            isHot: 'is_hot',
            isActive: 'is_active',
            isShared: 'is_shared',
            sortOrder: 'sort_order',
            purchaseLimit: 'purchase_limit',
            purchaseWarning: 'purchase_warning',
            createdAt: 'created_at',
            // Cards
            productId: 'product_id',
            cardKey: 'card_key',
            isUsed: 'is_used',
            reservedOrderId: 'reserved_order_id',
            reservedAt: 'reserved_at',
            usedAt: 'used_at',
            // Orders
            orderId: 'order_id',
            productName: 'product_name',
            tradeNo: 'trade_no',
            paidAt: 'paid_at',
            deliveredAt: 'delivered_at',
            userId: 'user_id',
            pointsUsed: 'points_used',
            currentPaymentId: 'current_payment_id',
            // Login Users
            lastLoginAt: 'last_login_at',
            isBlocked: 'is_blocked',
            // Refund Requests
            adminUsername: 'admin_username',
            adminNote: 'admin_note',
            processedAt: 'processed_at',
            // Settings
            updatedAt: 'updated_at',
            // Categories
            // icon, sortOrder covered already
        }

        let successCount = 0
        let errorCount = 0

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('--')) continue

            // Regex to parse INSERT OR IGNORE INTO <table> (...) VALUES (...)
            const match = trimmed.match(/INSERT OR IGNORE INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\((.+)\);/i)

            if (match) {
                const table = match[1]
                const columnsStr = match[2]
                const valuesStr = match[3]

                const columns = columnsStr.split(',').map(c => c.trim())

                // Map table name
                const tableMap: Record<string, string> = {
                    'daily_checkins': 'daily_checkins_v2'
                }
                const targetTable = tableMap[table] || table

                // Map columns
                const newColumns = columns.map(c => columnMap[c] || c)

                // Reconstruct statement
                const newStatement = `INSERT OR IGNORE INTO ${targetTable} (${newColumns.join(', ')}) VALUES (${valuesStr});`

                try {
                    await executeStatement(newStatement)
                    successCount++
                } catch (e: any) {
                    const errorMsg = e?.message || String(e)
                    // Silently skip if table doesn't exist (Vercel export might have tables that Workers doesn't have)
                    if (errorMsg.includes('no such table') || errorMsg.includes('does not exist')) {
                        // Skip silently - this is expected for some tables
                    } else {
                        console.error('Failed statement:', newStatement, errorMsg)
                    }
                    errorCount++
                }
            } else if (trimmed.toUpperCase().startsWith('INSERT')) {
                // Try executing other INSERTs directly if they match simple format
                try {
                    await executeStatement(trimmed)
                    successCount++
                } catch (e) {
                    errorCount++
                }
            }
        }

        revalidatePath('/admin')
        return { success: true, count: successCount, errors: errorCount }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}
