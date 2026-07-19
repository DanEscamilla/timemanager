import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import ThirdParty from "supertokens-node/recipe/thirdparty";
import Passwordless from "supertokens-node/recipe/passwordless";
import Session from "supertokens-node/recipe/session";
import Dashboard from "supertokens-node/recipe/dashboard";
import UserRoles from "supertokens-node/recipe/userroles";
import Multitenancy from "supertokens-node/recipe/multitenancy";
import MultiFactorAuth from "supertokens-node/recipe/multifactorauth";
import AccountLinking from "supertokens-node/recipe/accountlinking";
import EmailVerification from "supertokens-node/recipe/emailverification";
import WebAuthN from "supertokens-node/recipe/webauthn";
import type { AccountInfoWithRecipeId } from "supertokens-node/recipe/accountlinking/types";
import type { User } from "supertokens-node/types";
import type { TypeInput } from "supertokens-node/types";
import SuperTokens from "supertokens-node";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
}

export function getPort(): number {
    const raw = process.env.PORT;
    if (raw) {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
    return 3001;
}

export function getApiDomain() {
    return process.env.API_DOMAIN ?? `http://localhost:${getPort()}`;
}

export function getWebsiteDomain() {
    return process.env.WEBSITE_DOMAIN ?? "http://localhost:3000";
}

function parseAllowedOrigins(): string[] {
    const raw = process.env.ALLOWED_ORIGINS;
    if (!raw?.trim()) return [];
    return raw
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}

/** Allow React website domain, Flutter web, and explicit ALLOWED_ORIGINS. */
export function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    if (origin === getWebsiteDomain()) return true;
    if (parseAllowedOrigins().includes(origin)) return true;
    try {
        const url = new URL(origin);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
        return false;
    }
}

export const SuperTokensConfig: TypeInput = {
    supertokens: {
        connectionURI:
            process.env.SUPERTOKENS_CONNECTION_URI ??
            "https://try.supertokens.com",
    },
    appInfo: {
        appName: "Time Management",
        apiDomain: getApiDomain(),
        websiteDomain: getWebsiteDomain(),
        apiBasePath: "/auth",
        websiteBasePath: "/auth",
    },
    recipeList: [
        EmailPassword.init(),
        ThirdParty.init({
            signInAndUpFeature: {
                providers: [
                    {
                        config: {
                            thirdPartyId: "google",
                            clients: [
                                {
                                    clientId: process.env.GOOGLE_CLIENT_ID!,
                                    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
                                },
                            ],
                        },
                    },
                    {
                        config: {
                            thirdPartyId: "github",
                            clients: [
                                {
                                    clientId: process.env.GITHUB_CLIENT_ID!,
                                    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
                                },
                            ],
                        },
                    },
                    {
                        config: {
                            thirdPartyId: "apple",
                            clients: [
                                {
                                    clientId: process.env.APPLE_CLIENT_ID!,
                                    clientSecret: process.env.APPLE_CLIENT_SECRET!,
                                    additionalConfig: {
                                        keyId: process.env.APPLE_KEY_ID!,
                                        privateKey: process.env.APPLE_PRIVATE_KEY!,
                                        teamId: process.env.APPLE_TEAM_ID!,
                                    },
                                },
                            ],
                        },
                    },
                    {
                        config: {
                            thirdPartyId: "twitter",
                            clients: [
                                {
                                    clientId: process.env.TWITTER_CLIENT_ID!,
                                    clientSecret: process.env.TWITTER_CLIENT_SECRET!,
                                },
                            ],
                        },
                    }
                ],
            },
        }),
        Passwordless.init({
    contactMethod: "EMAIL",
    flowType: "USER_INPUT_CODE_AND_MAGIC_LINK"
}),
        Dashboard.init(),
        UserRoles.init(),
        Multitenancy.init({
        override: {
            functions: (oI) => {
                return {
                    ...oI,
                };
            },
        },
    }),
        MultiFactorAuth.init({
    firstFactors: ["thirdparty", "emailpassword"]
}),
        AccountLinking.init({
            shouldDoAutomaticAccountLinking: async (
                _newAccountInfo: AccountInfoWithRecipeId,
                _user: User | undefined,
                _session: any,
                _tenantId: string,
                _userContext: any
            ) => {
                return {
                    shouldAutomaticallyLink: true,
                    shouldRequireVerification: false
                };
            }
        }),
        EmailVerification.init({
        mode: "OPTIONAL"
    }),
        WebAuthN.init(),
        // Do not force cookie or header — clients send st-auth-mode
        // (React cookies, Flutter headers). Put email in the JWT for GraphQL.
        Session.init({
            override: {
                functions: (originalImplementation) => ({
                    ...originalImplementation,
                    createNewSession: async (input) => {
                        const user = await SuperTokens.getUser(input.userId);
                        const email = user?.emails[0];
                        input.accessTokenPayload = {
                            ...input.accessTokenPayload,
                            email,
                        };
                        return originalImplementation.createNewSession(input);
                    },
                }),
            },
        }),
    ],
};
