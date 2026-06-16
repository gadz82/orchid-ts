/**
 * MCP OAuth discovery — probes MCP servers for OAuth metadata using the
 * MCP protocol and well-known endpoints (RFC 8414 style via MCP resources).
 *
 * Uses @modelcontextprotocol/sdk for MCP protocol operations.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_CLIENT_INFO = {
    name: "orchid-mcp-discovery",
    version: "1.0.0",
};

const DISCOVERY_TIMEOUT_MS = 15_000;

function timeoutSignal(ms: number): AbortSignal {
    return AbortSignal.timeout(ms);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${ms}ms`));
        }, ms);
        promise.then(
            (val) => {
                clearTimeout(timer);
                resolve(val);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

export class OrchidMCPAuthDiscovery {
    /**
     * Probe an MCP server for OAuth metadata by listing resources and
     * looking for well-known OAuth metadata entries.
     *
     * Returns null if no OAuth metadata is found (server does not support OAuth).
     */
    static async probeOAuthMetadata(client: Client): Promise<Record<string, unknown> | null> {
        try {
            const resources = await client.listResources();
            if (!resources || !resources.resources) return null;

            for (const resource of resources.resources) {
                const uri = resource.uri;
                // Well-known OAuth metadata resource URIs
                if (
                    uri === "mcp://oauth/metadata" ||
                    uri === "urn:mcp:oauth:metadata" ||
                    uri.endsWith("/.well-known/oauth-protected-resource") ||
                    uri.endsWith("/.well-known/oauth-authorization-server")
                ) {
                    const result = await client.readResource({ uri: resource.uri });
                    if (result && result.contents) {
                        for (const content of result.contents) {
                            const textContent = content as {
                                uri: string;
                                text?: string;
                                blob?: string;
                                mimeType?: string;
                            };
                            if (textContent.text) {
                                try {
                                    const parsed = JSON.parse(textContent.text) as Record<
                                        string,
                                        unknown
                                    >;
                                    return parsed;
                                } catch {
                                    return { raw: textContent.text, uri: resource.uri };
                                }
                            }
                        }
                    }
                }
            }
            return null;
        } catch (exc: unknown) {
            console.debug("[OrchidMCPAuthDiscovery] probeOAuthMetadata failed: %o", exc);
            return null;
        }
    }

    /**
     * Connect to an MCP server and discover its OAuth endpoints.
     * Returns endpoint metadata or null if server doesn't support OAuth.
     *
     * The returned object may contain:
     *   - authorizationEndpoint
     *   - tokenEndpoint
     *   - registrationEndpoint
     *   - issuer
     *   - scopesSupported
     *   - tokenEndpointAuthMethodsSupported
     */
    static async discoverEndpoints(serverUrl: string): Promise<Record<string, unknown> | null> {
        let transport: StreamableHTTPClientTransport | null = null;

        try {
            transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
                requestInit: {
                    signal: timeoutSignal(DISCOVERY_TIMEOUT_MS),
                },
            });

            const client = new Client(DEFAULT_CLIENT_INFO);
            await withTimeout(client.connect(transport), DISCOVERY_TIMEOUT_MS);

            const meta = await this.probeOAuthMetadata(client);

            try {
                await client.close();
            } catch {
                // ignore
            }

            return meta;
        } catch (exc: unknown) {
            console.debug(
                "[OrchidMCPAuthDiscovery] discoverEndpoints failed for %s: %o",
                serverUrl,
                exc,
            );
            return null;
        } finally {
            if (transport) {
                try {
                    await transport.close();
                } catch {
                    // ignore
                }
            }
        }
    }

    /**
     * Register a dynamic client with the MCP server's registration endpoint
     * (RFC 7591). Returns the registration response containing client_id,
     * client_secret, etc.
     */
    static async registerClient({
        registrationEndpoint,
        clientName,
        redirectUris,
    }: {
        registrationEndpoint: string;
        clientName: string;
        redirectUris: string[];
    }): Promise<Record<string, unknown>> {
        const payload: Record<string, unknown> = {
            client_name: clientName,
            redirect_uris: redirectUris,
            grant_types: ["authorization_code", "refresh_token"],
            token_endpoint_auth_method: "client_secret_post",
            response_types: ["code"],
        };

        const response = await fetch(registrationEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(payload),
            signal: timeoutSignal(DISCOVERY_TIMEOUT_MS),
        });

        if (!response.ok) {
            let errorBody = "";
            try {
                errorBody = await response.text();
            } catch {
                // ignore
            }
            throw new Error(
                `Dynamic client registration failed (HTTP ${response.status}): ${errorBody}`,
            );
        }

        const data = (await response.json()) as Record<string, unknown>;
        return data;
    }

    /**
     * Build a well-known OAuth metadata URL from a base server URL.
     * Attempts common conventions.
     */
    static buildWellKnownUrl(serverUrl: string): string | null {
        try {
            const url = new URL(serverUrl);
            // Strip trailing path components to get base origin
            url.pathname = "/.well-known/oauth-authorization-server";
            url.search = "";
            return url.toString();
        } catch {
            return null;
        }
    }

    /**
     * Fetch OAuth server metadata from a well-known URL (RFC 8414).
     * Returns parsed JSON or null.
     */
    static async fetchWellKnown(wellKnownUrl: string): Promise<Record<string, unknown> | null> {
        try {
            const response = await fetch(wellKnownUrl, {
                method: "GET",
                headers: { Accept: "application/json" },
                signal: timeoutSignal(DISCOVERY_TIMEOUT_MS),
            });
            if (!response.ok) return null;
            const data = (await response.json()) as Record<string, unknown>;
            return data;
        } catch (exc: unknown) {
            console.debug(
                "[OrchidMCPAuthDiscovery] fetchWellKnown failed for %s: %o",
                wellKnownUrl,
                exc,
            );
            return null;
        }
    }

    /**
     * Full discovery pipeline: try well-known URL first, then MCP protocol probe.
     */
    static async discoverOAuthEndpoints(
        serverUrl: string,
    ): Promise<Record<string, unknown> | null> {
        const wellKnown = this.buildWellKnownUrl(serverUrl);
        if (wellKnown) {
            const wkData = await this.fetchWellKnown(wellKnown);
            if (wkData) {
                return wkData;
            }
        }
        return this.discoverEndpoints(serverUrl);
    }
}
