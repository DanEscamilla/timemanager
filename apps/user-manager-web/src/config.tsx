
"use client";

import Multitenancy from "supertokens-auth-react/recipe/multitenancy";
import EmailPassword from "supertokens-auth-react/recipe/emailpassword";
import { EmailPasswordPreBuiltUI } from "supertokens-auth-react/recipe/emailpassword/prebuiltui";
import ThirdParty from "supertokens-auth-react/recipe/thirdparty";
import { ThirdPartyPreBuiltUI } from "supertokens-auth-react/recipe/thirdparty/prebuiltui";
import Passwordless, { PasswordlessComponentsOverrideProvider } from "supertokens-auth-react/recipe/passwordless";
import { PasswordlessPreBuiltUI } from "supertokens-auth-react/recipe/passwordless/prebuiltui";
import MultiFactorAuth from "supertokens-auth-react/recipe/multifactorauth";
import { MultiFactorAuthPreBuiltUI } from "supertokens-auth-react/recipe/multifactorauth/prebuiltui";
import EmailVerification from "supertokens-auth-react/recipe/emailverification";
import { EmailVerificationPreBuiltUI } from "supertokens-auth-react/recipe/emailverification/prebuiltui";
import WebAuthn from "supertokens-auth-react/recipe/webauthn";
import { WebauthnPreBuiltUI } from "supertokens-auth-react/recipe/webauthn/prebuiltui";
import TOTP from "supertokens-auth-react/recipe/totp";
import { TOTPPreBuiltUI } from "supertokens-auth-react/recipe/totp/prebuiltui";
import Session from "supertokens-auth-react/recipe/session";
import { useState, useEffect } from "react";

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

export const styleOverride = `
[data-supertokens~=tenants-link] {
    margin-top: 8px;
}
`;

export const SuperTokensConfig = {
    appInfo: {
        appName: "SuperTokens Demo App",
        apiDomain: getApiDomain(),
        websiteDomain: getWebsiteDomain(),
        apiBasePath: "/auth",
        websiteBasePath: "/auth",
    },
    usesDynamicLoginMethods: true,
    style: styleOverride,
    
    recipeList: [
        Multitenancy.init({
            override: {
                functions: (oI) => {
                    return {
                        ...oI,
                        getTenantId: async () => {
                            if (typeof window !== 'undefined') {
                                const tenantIdInStorage = localStorage.getItem("tenantId");
                                return tenantIdInStorage === null ? undefined : tenantIdInStorage;
                            }
                        },
                    };
                },
            },
        }),
        EmailPassword.init(),
        ThirdParty.init({
            signInAndUpFeature: {
                providers: [
                    ThirdParty.Google.init(),
                    ThirdParty.Github.init(),
                    ThirdParty.Apple.init(),
                    ThirdParty.Twitter.init()
                ],
            },
        }),
        Passwordless.init({
            contactMethod: "EMAIL"
        }),
        MultiFactorAuth.init({
        firstFactors: ["thirdparty", "emailpassword"]
    }),
        EmailVerification.init({
        mode: "REQUIRED"
    }),
        WebAuthn.init(),
        TOTP.init(),
        Session.init()
    ],
    getRedirectionURL: async (context: any) => {
        if (context.action === "SUCCESS") {
            return "/dashboard";
        }
        return undefined;
    },
};

export const recipeDetails = {
    docsLink: "https://supertokens.com/docs/quickstart/introduction",
};

export const PreBuiltUIList = [EmailPasswordPreBuiltUI, ThirdPartyPreBuiltUI, PasswordlessPreBuiltUI, MultiFactorAuthPreBuiltUI, EmailVerificationPreBuiltUI, WebauthnPreBuiltUI, TOTPPreBuiltUI];


type Tenant = {
    tenantId: string;
}

const tenantLoader = async (): Promise<Tenant[]> => {
    try {
        const response = await fetch(`${getApiDomain()}/tenants`);
        if (!response.ok) {
            throw new Error(`Failed to fetch tenants: ${response.statusText}`);
        }
        const responseData = await response.json();
        if (responseData && responseData.status === "OK" && Array.isArray(responseData.tenants)) {
            return responseData.tenants as Tenant[];
        } else if (Array.isArray(responseData)) {
             return responseData as Tenant[];
        }
        console.error("Unexpected response format from /tenants:", responseData);
        throw new Error("Failed to parse tenants data from server.");
    } catch (error) {
        console.error("Error fetching tenants:", error);
        return [];
    }
};

const TenantSwitcherFooter = () => {
    const [currentTenantId, setCurrentTenantId] = useState<string>("public");
    const [showTenantSwitcher, setShowTenantSwitcher] = useState(false);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function setup() {
            setLoading(true);

            const storedTenantId = localStorage.getItem("tenantId");
            if (storedTenantId && storedTenantId !== currentTenantId) {
                setCurrentTenantId(storedTenantId);
            }

            try {
                const loadedTenants = await tenantLoader();
                setTenants(loadedTenants);
            } catch (err) {
                console.error("Error loading tenants:", err);
                setError(err instanceof Error ? err.message : "Failed to load tenants");
            } finally {
                setLoading(false);
            }
        }

        setup();

    }, []);

    const openTenantModal = () => {
        setShowTenantSwitcher(true);
    };

    const closeTenantModal = () => {
        setShowTenantSwitcher(false);
    };

    const selectTenant = (tenantId: string) => {
        localStorage.setItem("tenantId", tenantId);
        setCurrentTenantId(tenantId);
        closeTenantModal();
        window.location.href = "/auth";
    };

    return (
        <>
            <div id="st-tenant-selector-footer">
                <span id="st-current-tenant-display">Current Tenant: {currentTenantId || 'None'}</span>
                <button id="st-switch-tenant-btn" onClick={openTenantModal}>
                    Switch Tenant
                </button>
            </div>
            <div
                id="st-tenant-modal-backdrop"
                onClick={closeTenantModal}
                style={{ display: showTenantSwitcher ? 'flex' : 'none' }}
            >
                <div id="st-tenant-modal" onClick={(e) => e.stopPropagation()}>
                    <button id="st-tenant-modal-close" title="Close" onClick={closeTenantModal}>&times;</button>
                        <h3>Select Tenant</h3>
                        <ul id="st-tenant-list">
                            {loading ? (
                                <li>Loading tenants...</li>
                            ) : error ? (
                                <li>{error}</li>
                            ) : tenants.length === 0 ? (
                                <li>No tenants available or failed to load.</li>
                            ) : (
                                tenants.map((tenant) => (
                                    <li
                                        key={tenant.tenantId}
                                        data-tenant-id={tenant.tenantId}
                                        onClick={() => selectTenant(tenant.tenantId)}
                                    >
                                        {tenant.tenantId}
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                </div>
        </>
    );
};



export const ComponentWrapper = (props: { children: JSX.Element }): JSX.Element => {
    let childrenToRender = props.children;

    childrenToRender = (
        <PasswordlessComponentsOverrideProvider
            components={{
                PasswordlessUserInputCodeFormFooter_Override: ({ DefaultComponent, ...cProps }) => {
                    const loginAttemptInfo = cProps.loginAttemptInfo;
                    let showQuotaMessage = false;

                    if (loginAttemptInfo.contactMethod === "PHONE") {
                        showQuotaMessage = true;
                    }

                    return (
                        <div
                            style={{
                                width: "100%",
                            }}
                        >
                            <DefaultComponent {...cProps} />
                            {showQuotaMessage && (
                                <div
                                    style={{
                                        width: "100%",
                                        paddingLeft: 12,
                                        paddingRight: 12,
                                        paddingTop: 6,
                                        paddingBottom: 6,
                                        borderRadius: 4,
                                        backgroundColor: "#EF9A9A",
                                        margin: 0,
                                        boxSizing: "border-box",
                                        MozBoxSizing: "border-box",
                                        WebkitBoxSizing: "border-box",
                                        fontSize: 12,
                                        textAlign: "start",
                                        fontWeight: "bold",
                                        lineHeight: "18px",
                                    }}
                                >
                                    There is a daily quota for the free SMS service, if you do not receive the SMS
                                    please try again tomorrow.
                                </div>
                            )}
                        </div>
                    );
                },
            }}
        >
            {props.children}
        </PasswordlessComponentsOverrideProvider>
    );
    return (
        <>
            {childrenToRender}
            <TenantSwitcherFooter />
        </>
    );
}