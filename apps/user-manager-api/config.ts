import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import ThirdParty from "supertokens-node/recipe/thirdparty";
import type { ProviderInput } from "supertokens-node/recipe/thirdparty/types";
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

export function getApiDomain() {
    const apiPort = 3001;
    const apiUrl = `http://localhost:${apiPort}`;
    return apiUrl;
}

export function getWebsiteDomain() {
    const websitePort = 3000;
    const websiteUrl = `http://localhost:${websitePort}`;
    return websiteUrl;
}

/** Allow React (:3000) and Flutter web (dynamic localhost ports) in local dev. */
export function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    if (origin === getWebsiteDomain()) return true;
    try {
        const url = new URL(origin);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
        return false;
    }
}

export const SuperTokensConfig: TypeInput = {
    supertokens: {
        connectionURI: "https://try.supertokens.com",
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
                newAccountInfo: AccountInfoWithRecipeId,
                user: User | undefined,
                session: any,
                tenantId: string,
                userContext: any
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