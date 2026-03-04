import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { loginUsers } from "@/lib/db/schema"

const githubClientId = process.env.GITHUB_ID || process.env.AUTH_GITHUB_ID
const githubClientSecret = process.env.GITHUB_SECRET || process.env.AUTH_GITHUB_SECRET

const providers: any[] = [
    {
        id: "linuxdo",
        name: "Linux DO",
        type: "oauth",
        authorization: "https://connect.linux.do/oauth2/authorize",
        token: {
            url: "https://connect.linux.do/oauth2/token",
            async conform(response: Response) {
                const contentType = response.headers.get("content-type") || ""
                if (contentType.includes("application/json")) return response

                const body = await response.clone().text()
                const bodyPreview = body.slice(0, 1000)

                console.error("[auth-temp][linuxdo-token]", {
                    status: response.status,
                    contentType,
                    bodyPreview,
                })

                // Some providers return JSON with an unexpected content-type.
                if (bodyPreview.trim().startsWith("{")) {
                    return new Response(body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: { "content-type": "application/json" },
                    })
                }

                return response
            },
        },
        userinfo: "https://connect.linux.do/api/user",
        issuer: "https://connect.linux.do/",
        clientId: process.env.OAUTH_CLIENT_ID,
        clientSecret: process.env.OAUTH_CLIENT_SECRET,
        profile(profile: any) {
            return {
                id: String(profile.id),
                name: profile.username || profile.name,
                email: profile.email,
                image: profile.avatar_url,
                trustLevel: profile.trust_level,
                avatar_url: profile.avatar_url,
                username: profile.username,
            }
        },
    }
]

async function resolveExistingGitHubUserIdByUsername(username?: string | null) {
    if (!username) return null
    const normalizedUsername = username.trim().toLowerCase()
    if (!normalizedUsername.startsWith("gh_")) return null

    try {
        const rows = await db
            .select({ userId: loginUsers.userId })
            .from(loginUsers)
            .where(sql`LOWER(${loginUsers.username}) = ${normalizedUsername}`)
            .orderBy(sql`COALESCE(${loginUsers.lastLoginAt}, 0) DESC`)
            .limit(1)
        return rows[0]?.userId ?? null
    } catch {
        return null
    }
}

async function resolveExistingLinuxDoUserIdByUsername(username?: string | null) {
    if (!username) return null
    const normalizedUsername = username.trim().toLowerCase()
    if (!normalizedUsername || normalizedUsername.startsWith("gh_")) return null

    try {
        const rows = await db
            .select({ userId: loginUsers.userId })
            .from(loginUsers)
            .where(sql`LOWER(${loginUsers.username}) = ${normalizedUsername}`)
            .orderBy(sql`COALESCE(${loginUsers.lastLoginAt}, 0) DESC`)
            .limit(1)
        return rows[0]?.userId ?? null
    } catch {
        return null
    }
}

function normalizeGitHubUserId(rawId?: string | null) {
    if (!rawId) return null
    let normalized = String(rawId).trim()
    while (normalized.toLowerCase().startsWith("github:")) {
        normalized = normalized.slice("github:".length)
    }
    if (!normalized) return null
    return `github:${normalized}`
}

function asTimestampMs(value: Date | number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null
    if (value instanceof Date) return value.getTime()
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

async function runAuthMigrationStep(statement: any) {
    try {
        await db.run(statement)
    } catch {
        // best effort in auth callback
    }
}

async function migrateLegacyUserId(sourceUserId: string, targetUserId: string, username?: string | null) {
    if (!sourceUserId || !targetUserId || sourceUserId === targetUserId) return

    const normalizedUsername = username?.trim().toLowerCase() || null

    try {
        const sourceRows = await db
            .select({
                userId: loginUsers.userId,
                username: loginUsers.username,
                email: loginUsers.email,
                points: loginUsers.points,
                isBlocked: sql<boolean>`COALESCE(${loginUsers.isBlocked}, FALSE)`,
                desktopNotificationsEnabled: sql<boolean>`COALESCE(${loginUsers.desktopNotificationsEnabled}, FALSE)`,
                createdAt: loginUsers.createdAt,
                lastLoginAt: loginUsers.lastLoginAt,
            })
            .from(loginUsers)
            .where(sql`${loginUsers.userId} = ${sourceUserId}`)
            .limit(1)
        if (!sourceRows.length) return

        const targetRows = await db
            .select({
                userId: loginUsers.userId,
                username: loginUsers.username,
                email: loginUsers.email,
                points: loginUsers.points,
                isBlocked: sql<boolean>`COALESCE(${loginUsers.isBlocked}, FALSE)`,
                desktopNotificationsEnabled: sql<boolean>`COALESCE(${loginUsers.desktopNotificationsEnabled}, FALSE)`,
                createdAt: loginUsers.createdAt,
                lastLoginAt: loginUsers.lastLoginAt,
            })
            .from(loginUsers)
            .where(sql`${loginUsers.userId} = ${targetUserId}`)
            .limit(1)

        if (!targetRows.length) {
            const source = sourceRows[0]
            const createdAt = asTimestampMs(source.createdAt) || Date.now()
            const lastLoginAt = asTimestampMs(source.lastLoginAt) || Date.now()
            await runAuthMigrationStep(sql`
                INSERT OR IGNORE INTO login_users (
                    user_id,
                    username,
                    email,
                    points,
                    is_blocked,
                    desktop_notifications_enabled,
                    created_at,
                    last_login_at
                ) VALUES (
                    ${targetUserId},
                    ${normalizedUsername || source.username || null},
                    ${source.email || null},
                    ${Number(source.points || 0)},
                    ${source.isBlocked ? 1 : 0},
                    ${source.desktopNotificationsEnabled ? 1 : 0},
                    ${createdAt},
                    ${lastLoginAt}
                )
            `)
        } else {
            const source = sourceRows[0]
            const target = targetRows[0]
            const mergedPoints = Number(source.points || 0) + Number(target.points || 0)
            const mergedBlocked = !!source.isBlocked || !!target.isBlocked
            const mergedDesktopEnabled = !!source.desktopNotificationsEnabled || !!target.desktopNotificationsEnabled
            const mergedEmail = target.email || source.email || null

            const createdCandidates = [asTimestampMs(source.createdAt), asTimestampMs(target.createdAt)].filter((v): v is number => v !== null)
            const lastLoginCandidates = [asTimestampMs(source.lastLoginAt), asTimestampMs(target.lastLoginAt)].filter((v): v is number => v !== null)
            const mergedCreatedAt = createdCandidates.length ? new Date(Math.min(...createdCandidates)) : new Date()
            const mergedLastLoginAt = lastLoginCandidates.length ? new Date(Math.max(...lastLoginCandidates)) : new Date()

            await db.update(loginUsers)
                .set({
                    username: normalizedUsername || target.username || source.username || null,
                    email: mergedEmail,
                    points: mergedPoints,
                    isBlocked: mergedBlocked,
                    desktopNotificationsEnabled: mergedDesktopEnabled,
                    createdAt: mergedCreatedAt,
                    lastLoginAt: mergedLastLoginAt,
                })
                .where(sql`${loginUsers.userId} = ${targetUserId}`)
        }

        await runAuthMigrationStep(sql`
            DELETE FROM broadcast_reads
            WHERE user_id = ${sourceUserId}
              AND EXISTS (
                SELECT 1
                FROM broadcast_reads br
                WHERE br.message_id = broadcast_reads.message_id
                  AND br.user_id = ${targetUserId}
              )
        `)
        await runAuthMigrationStep(sql`
            DELETE FROM wishlist_votes
            WHERE user_id = ${sourceUserId}
              AND EXISTS (
                SELECT 1
                FROM wishlist_votes wv
                WHERE wv.item_id = wishlist_votes.item_id
                  AND wv.user_id = ${targetUserId}
              )
        `)

        await runAuthMigrationStep(sql`UPDATE orders SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE reviews SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE refund_requests SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE daily_checkins_v2 SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE user_notifications SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE user_messages SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE broadcast_reads SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE wishlist_votes SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE wishlist_items SET user_id = ${targetUserId} WHERE user_id = ${sourceUserId}`)
        await runAuthMigrationStep(sql`UPDATE admin_messages SET target_value = ${targetUserId} WHERE target_type = 'userId' AND target_value = ${sourceUserId}`)

        if (normalizedUsername) {
            await runAuthMigrationStep(sql`
                UPDATE orders SET username = ${normalizedUsername}
                WHERE user_id = ${targetUserId}
                  AND (username IS NULL OR LOWER(username) NOT LIKE 'gh_%')
            `)
            await runAuthMigrationStep(sql`
                UPDATE reviews SET username = ${normalizedUsername}
                WHERE user_id = ${targetUserId}
                  AND (username IS NULL OR LOWER(username) NOT LIKE 'gh_%')
            `)
            await runAuthMigrationStep(sql`
                UPDATE refund_requests SET username = ${normalizedUsername}
                WHERE user_id = ${targetUserId}
                  AND (username IS NULL OR LOWER(username) NOT LIKE 'gh_%')
            `)
            await runAuthMigrationStep(sql`
                UPDATE user_messages SET username = ${normalizedUsername}
                WHERE user_id = ${targetUserId}
                  AND (username IS NULL OR LOWER(username) NOT LIKE 'gh_%')
            `)
            await runAuthMigrationStep(sql`
                UPDATE wishlist_items SET username = ${normalizedUsername}
                WHERE user_id = ${targetUserId}
                  AND (username IS NULL OR LOWER(username) NOT LIKE 'gh_%')
            `)
            await runAuthMigrationStep(sql`
                UPDATE login_users SET username = ${normalizedUsername}
                WHERE user_id = ${targetUserId}
                  AND (username IS NULL OR LOWER(username) <> ${normalizedUsername})
            `)
        }

        await runAuthMigrationStep(sql`DELETE FROM login_users WHERE user_id = ${sourceUserId}`)
    } catch (error) {
        console.warn("[auth] legacy user id migration failed", {
            sourceUserId,
            targetUserId,
            error,
        })
    }
}

if (githubClientId && githubClientSecret) {
    providers.push(
        GitHub({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            profile(profile) {
                const rawLogin = typeof profile.login === "string" && profile.login.trim().length > 0
                    ? profile.login
                    : String(profile.id)
                const login = rawLogin.toLowerCase()
                return {
                    id: String(profile.id),
                    name: profile.name || rawLogin,
                    email: profile.email,
                    image: profile.avatar_url,
                    // Prefix GitHub usernames to avoid collisions with Linux DO usernames.
                    username: `gh_${login}`,
                    avatar_url: profile.avatar_url,
                }
            },
        })
    )
} else {
    console.warn("[auth] GitHub login disabled: missing GITHUB_ID/GITHUB_SECRET")
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers,
    callbacks: {
        async jwt({ token, user, profile, account }) {
            if (user) {
                let resolvedId = String(user.id)
                let resolvedUsername = user.username ? String(user.username) : null

                if (account?.provider === "github") {
                    if (resolvedUsername) {
                        resolvedUsername = resolvedUsername.toLowerCase()
                    }

                    // Prefer providerAccountId for GitHub; it's the most stable account identifier.
                    const canonicalGitHubId = normalizeGitHubUserId(account.providerAccountId) || normalizeGitHubUserId(String(user.id))
                    if (canonicalGitHubId) resolvedId = canonicalGitHubId

                    // If this GitHub username already exists in login_users, keep using that user_id.
                    const existingUserId = await resolveExistingGitHubUserIdByUsername(resolvedUsername)
                    if (existingUserId) {
                        const normalizedExistingId = normalizeGitHubUserId(existingUserId)
                        if (canonicalGitHubId) {
                            if (existingUserId !== canonicalGitHubId) {
                                await migrateLegacyUserId(existingUserId, canonicalGitHubId, resolvedUsername)
                            }
                            resolvedId = canonicalGitHubId
                        } else if (normalizedExistingId) {
                            resolvedId = normalizedExistingId
                        } else {
                            resolvedId = existingUserId
                        }
                    }
                } else if (account?.provider === "linuxdo") {
                    // Linux DO user id must be the official immutable `id` field from userinfo.
                    const rawLinuxDoId = (profile as any)?.id
                    const canonicalLinuxDoId =
                        rawLinuxDoId === undefined || rawLinuxDoId === null
                            ? null
                            : String(rawLinuxDoId).trim()

                    if (!canonicalLinuxDoId) {
                        console.error("[auth] linuxdo canonical id missing", {
                            profileId: (profile as any)?.id ?? null,
                            username: resolvedUsername ?? null,
                        })
                        throw new Error("LINUXDO_CANONICAL_ID_MISSING")
                    }

                    const existingLinuxDoUserId = await resolveExistingLinuxDoUserIdByUsername(resolvedUsername)
                    if (existingLinuxDoUserId) {
                        if (existingLinuxDoUserId !== canonicalLinuxDoId) {
                            await migrateLegacyUserId(existingLinuxDoUserId, canonicalLinuxDoId, resolvedUsername)
                        }
                    }
                    resolvedId = canonicalLinuxDoId
                }

                token.id = resolvedId
                if (resolvedUsername) token.username = resolvedUsername
                if (user.trustLevel !== undefined) token.trustLevel = user.trustLevel
                if (user.avatar_url) token.avatar_url = user.avatar_url
                else if (user.image) token.avatar_url = user.image
                return token
            }

            if (profile && account?.provider === "linuxdo") {
                const rawLinuxDoId = (profile as any)?.id
                const linuxDoId =
                    rawLinuxDoId === undefined || rawLinuxDoId === null
                        ? null
                        : String(rawLinuxDoId).trim()
                if (!linuxDoId) {
                    console.error("[auth] linuxdo profile.id missing in profile callback", {
                        profileId: (profile as any)?.id ?? null,
                        username: (profile as any)?.username ?? null,
                    })
                    throw new Error("LINUXDO_CANONICAL_ID_MISSING")
                }

                token.id = linuxDoId
                token.username = (profile as any).username
                token.trustLevel = (profile as any).trust_level
                token.avatar_url = (profile as any).avatar_url
            }
            return token
        },
        async session({ session, token }) {
            if (token) {
                session.user.id = token.id as string
                // @ts-ignore
                session.user.username = token.username
                // @ts-ignore
                session.user.trustLevel = token.trustLevel
                // @ts-ignore
                session.user.avatar_url = token.avatar_url
            }
            return session
        }
    },
    pages: {
        signIn: "/login"
    },
    // Temporary diagnostics: keep this until OAuth callback issue is resolved.
    logger: {
        error(error) {
            console.error("[auth-temp]", {
                name: error.name,
                message: error.message,
                // Auth.js puts provider details under error.cause when available.
                cause: (error as Error & { cause?: unknown }).cause,
                stack: error.stack,
            })
        },
    },
    // Use OAUTH_CLIENT_SECRET as fallback if NEXTAUTH_SECRET is not set
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.OAUTH_CLIENT_SECRET,
    trustHost: true,

})
