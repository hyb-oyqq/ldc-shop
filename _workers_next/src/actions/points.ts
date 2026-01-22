'use server'

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { loginUsers } from "@/lib/db/schema"
import { ensureLoginUsersSchema, getSetting } from "@/lib/db/queries"
import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function checkIn() {
    const session = await auth()
    if (!session?.user?.id) {
        return { success: false, error: "Not logged in" }
    }

    // 0. Check if feature is enabled
    const enabledStr = await getSetting('checkin_enabled')
    if (enabledStr === 'false') {
        return { success: false, error: "Check-in is currently disabled" }
    }

    const userId = session.user.id

    try {
        await ensureLoginUsersSchema()
        // Get user state
        const user = await db.query.loginUsers.findFirst({
            where: eq(loginUsers.userId, userId),
            columns: {
                lastCheckinAt: true,
                consecutiveDays: true,
                points: true
            }
        })

        if (!user) {
            // Should not happen for logged in user, but just in case
            return { success: false, error: "User record not found" }
        }

        const now = Date.now()
        // Use UTC date boundaries to ensure consistency
        const lastCheckin = user.lastCheckinAt ? new Date(user.lastCheckinAt) : new Date(0);
        const lastCheckinDate = lastCheckin.toISOString().split('T')[0];
        const todayDate = new Date().toISOString().split('T')[0];

        if (lastCheckinDate === todayDate && user.lastCheckinAt) {
            return { success: false, error: "Already checked in today" }
        }

        // Calculate consecutive days
        const yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        let newConsecutiveDays = 1;

        if (lastCheckinDate === yesterdayDate) {
            newConsecutiveDays = (user.consecutiveDays || 0) + 1;
        }

        // 2. Get Reward Amount
        const rewardStr = await getSetting('checkin_reward')
        const reward = parseInt(rewardStr || '10', 10)

        // 3. Perform Check-in & Award Points
        await db.update(loginUsers)
            .set({
                points: sql`${loginUsers.points} + ${reward}`,
                lastCheckinAt: new Date(),
                consecutiveDays: newConsecutiveDays
            })
            .where(eq(loginUsers.userId, userId))

        revalidatePath('/')
        return { success: true, points: reward, consecutiveDays: newConsecutiveDays }
    } catch (error: any) {
        console.error("Check-in error:", error)
        return { success: false, error: `Check-in failed: ${error?.message || 'Unknown error'}` }
    }
}

export async function getUserPoints() {
    const session = await auth()
    if (!session?.user?.id) return 0

    const user = await db.query.loginUsers.findFirst({
        where: eq(loginUsers.userId, session.user.id),
        columns: { points: true }
    })

    return user?.points || 0
}

export async function getCheckinStatus() {
    const session = await auth()
    if (!session?.user?.id) return { checkedIn: false }

    const enabledStr = await getSetting('checkin_enabled')
    if (enabledStr === 'false') {
        return { checkedIn: false, disabled: true }
    }

    try {
        await ensureLoginUsersSchema()
        const user = await db.query.loginUsers.findFirst({
            where: eq(loginUsers.userId, session.user.id),
            columns: { lastCheckinAt: true }
        })

        if (!user || !user.lastCheckinAt) {
            return { checkedIn: false }
        }

        const lastCheckinDate = new Date(user.lastCheckinAt).toISOString().split('T')[0];
        const todayDate = new Date().toISOString().split('T')[0];

        return { checkedIn: lastCheckinDate === todayDate }
    } catch (error: any) {
        console.error('[CheckinStatus] Error:', error?.message)
        return { checkedIn: false }
    }
}
