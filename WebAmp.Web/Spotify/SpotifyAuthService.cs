using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace WebAmp.Web.Spotify;

public sealed class SpotifyAuthService
{
    // ============================================================================================
    // Private values
    // ============================================================================================

    private const string TicketCookieName = "wa_spotify_ticket";
    private const string OAuthStateCookieName = "wa_spotify_oauth_state";
    private const string PkceVerifierCookieName = "wa_spotify_pkce_verifier";
    private const string ReturnUrlCookieName = "wa_spotify_return";

    private readonly SpotifyOptions _options;
    private readonly string? _clientId;
    private readonly string? _clientSecret;
    private readonly string? _redirectUri;
    private readonly bool _requireSecureCookies;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IDataProtector _protector;

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    // ============================================================================================
    /// <summary>
    /// Initializes the Spotify authentication service.
    /// </summary>
    /// <param name="options">The Spotify options.</param>
    /// <param name="httpClientFactory">The HTTP client factory.</param>
    /// <param name="dataProtectionProvider">The data protection provider.</param>
    public SpotifyAuthService(
        IOptions<SpotifyOptions> options,
        IHttpClientFactory httpClientFactory,
        IDataProtectionProvider dataProtectionProvider)
    {
        _options = options.Value;
        _clientId = ResolveValueOrFile(_options.ClientId, _options.ClientIdFile, "Spotify:ClientId");
        _clientSecret = ResolveValueOrFile(_options.ClientSecret, _options.ClientSecretFile, "Spotify:ClientSecret");
        _redirectUri = string.IsNullOrWhiteSpace(_options.RedirectUri) ? null : _options.RedirectUri.Trim();
        _requireSecureCookies = _options.RequireSecureCookies;
        _httpClientFactory = httpClientFactory;
        _protector = dataProtectionProvider.CreateProtector("WebAmp.Spotify.AuthTicket.v1");
    }

    // ============================================================================================
    /// <summary>
    /// Checks if the Spotify authentication service is configured.
    /// </summary>
    /// <returns>True if the service is configured, false otherwise.</returns>
    public bool IsConfigured => !string.IsNullOrWhiteSpace(_clientId) && !string.IsNullOrWhiteSpace(_redirectUri);
    
    // ============================================================================================
    /// <summary>
    /// Generates the authorization URL for Spotify authentication.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="returnUrl">The URL to redirect to after authentication.</param>
    /// <returns>The authorization URL.</returns>

    public string GetAuthorizeUrl(HttpContext ctx, string returnUrl)
    {
        if (!IsConfigured) throw new InvalidOperationException("Spotify is not configured (missing ClientId/RedirectUri).");

        var state = SpotifyPkce.CreateState();
        var verifier = SpotifyPkce.CreateCodeVerifier();
        var challenge = SpotifyPkce.CreateCodeChallenge(verifier);

        WriteCookie(ctx, OAuthStateCookieName, state, TimeSpan.FromMinutes(10), httpOnly: true);
        WriteCookie(ctx, PkceVerifierCookieName, verifier, TimeSpan.FromMinutes(10), httpOnly: true);
        WriteCookie(ctx, ReturnUrlCookieName, returnUrl, TimeSpan.FromMinutes(10), httpOnly: true);

        var scopes = string.IsNullOrWhiteSpace(_options.Scopes)
            ? string.Join(' ', new[]
            {
                // Web Playback SDK + playback control + library browsing
                "streaming",
                "user-read-email",
                "user-read-private",
                "user-read-playback-state",
                "user-modify-playback-state",
                "user-read-currently-playing",
                "user-library-read",
                "user-follow-read",
                "playlist-read-private",
                "playlist-read-collaborative",
            })
            : _options.Scopes!;

        var q = new Dictionary<string, string?>
        {
            ["response_type"] = "code",
            ["client_id"] = _clientId,
            ["redirect_uri"] = _redirectUri,
            ["scope"] = scopes,
            ["state"] = state,
            ["code_challenge_method"] = "S256",
            ["code_challenge"] = challenge
        };

        var query = string.Join("&", q.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value ?? "")}"));
        return $"https://accounts.spotify.com/authorize?{query}";
    }

    // ============================================================================================
    /// <summary>
    /// Handles the callback from Spotify after authentication.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="code">The authorization code.</param>
    /// <param name="state">The state parameter.</param>
    /// <param name="error">The error parameter.</param>
    /// <returns>A tuple indicating success or failure, and an error message if applicable.</returns>
    public async Task<(bool ok, string? error)> HandleCallbackAsync(
        HttpContext ctx, 
        string? code,
        string? state, 
        string? error)
    {
        if (!IsConfigured) return (false, "Spotify is not configured.");
        if (!string.IsNullOrWhiteSpace(error)) return (false, error);
        if (string.IsNullOrWhiteSpace(code)) return (false, "Missing authorization code.");

        var expectedState = ReadCookie(ctx, OAuthStateCookieName);
        if (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(expectedState) || !FixedTimeEquals(state, expectedState))
        {
            return (false, "Invalid state.");
        }

        var verifier = ReadCookie(ctx, PkceVerifierCookieName);
        if (string.IsNullOrWhiteSpace(verifier)) return (false, "Missing PKCE verifier.");

        var token = await ExchangeCodeAsync(code, verifier);
        if (token is null) return (false, "Token exchange failed.");

        var ticket = new SpotifyAuthTicket
        {
            AccessToken = token.AccessToken,
            RefreshToken = token.RefreshToken ?? "",
            ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(token.ExpiresIn),
            Scope = token.Scope
        };

        if (string.IsNullOrWhiteSpace(ticket.RefreshToken))
        {
            // Refresh token should normally be present for auth code flow.
            return (false, "Spotify did not return a refresh token (check app type/scopes).");
        }

        WriteTicket(ctx, ticket);

        // Clear one-time cookies
        DeleteCookie(ctx, OAuthStateCookieName);
        DeleteCookie(ctx, PkceVerifierCookieName);

        return (true, null);
    }

    // ============================================================================================
    /// <summary>
    /// Consumes the return URL from the cookie and deletes the cookie.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="fallback">The fallback URL to use if the return URL is not valid.</param>
    /// <returns>The return URL.</returns>
    public string ConsumeReturnUrl(HttpContext ctx, string fallback = "/webamp")
    {
        var ru = ReadCookie(ctx, ReturnUrlCookieName);
        DeleteCookie(ctx, ReturnUrlCookieName);
        if (!string.IsNullOrWhiteSpace(ru) && Uri.IsWellFormedUriString(ru, UriKind.Relative))
        {
            return ru!;
        }
        return fallback;
    }

    // ============================================================================================
    /// <summary>
    /// Reads the authentication ticket from the cookie.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <returns>The authentication ticket.</returns>
    public SpotifyAuthTicket? ReadTicket(HttpContext ctx)
    {
        var raw = ReadCookie(ctx, TicketCookieName);
        if (string.IsNullOrWhiteSpace(raw)) return null;

        try
        {
            var json = _protector.Unprotect(raw);
            return JsonSerializer.Deserialize<SpotifyAuthTicket>(json, JsonOpts);
        }
        catch
        {
            return null;
        }
    }

    // ============================================================================================
    /// <summary>
    /// Clears the authentication ticket from the cookie.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    public void ClearTicket(HttpContext ctx) => DeleteCookie(ctx, TicketCookieName);

    // ============================================================================================
    /// <summary>
    /// Gets a valid access token from the authentication ticket.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <returns>The access token.</returns>
    public async Task<string?> GetValidAccessTokenAsync(HttpContext ctx)
    {
        var ticket = ReadTicket(ctx);
        if (ticket is null) return null;

        if (!ticket.IsExpiredOrNearExpiry())
        {
            return ticket.AccessToken;
        }

        var refreshed = await RefreshAsync(ticket.RefreshToken);
        if (refreshed is null) return null;

        ticket.AccessToken = refreshed.AccessToken;
        ticket.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(refreshed.ExpiresIn);
        // Refresh responses may omit refresh_token; keep existing.
        ticket.Scope = refreshed.Scope ?? ticket.Scope;

        WriteTicket(ctx, ticket);
        return ticket.AccessToken;
    }

    // ============================================================================================
    /// <summary>
    /// Writes the authentication ticket to the cookie.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="ticket">The authentication ticket.</param>
    private void WriteTicket(HttpContext ctx, SpotifyAuthTicket ticket)
    {
        var json = JsonSerializer.Serialize(ticket, JsonOpts);
        var protectedValue = _protector.Protect(json);
        // Persist longer than access token validity; refresh token should keep session alive.
        WriteCookie(ctx, TicketCookieName, protectedValue, TimeSpan.FromDays(30), httpOnly: true);
    }

    // ============================================================================================
    /// <summary>
    /// Exchanges the authorization code for an access token.
    /// </summary>
    /// <param name="code">The authorization code.</param>
    /// <param name="codeVerifier">The code verifier.</param>
    /// <returns>The token response.</returns>
    private async Task<SpotifyTokenResponse?> ExchangeCodeAsync(string code, string codeVerifier)
    {
        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://accounts.spotify.com/api/token");
        req.Content = new FormUrlEncodedContent(new Dictionary<string, string?>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = _redirectUri,
            ["client_id"] = _clientId,
            ["code_verifier"] = codeVerifier,
            // If configured as confidential, send secret via Basic auth as well.
        }!);

        AddClientAuthHeaderIfPresent(req);

        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) return null;
        return JsonSerializer.Deserialize<SpotifyTokenResponse>(body, JsonOpts);
    }

    // ============================================================================================
    /// <summary>
    /// Refreshes the access token using the refresh token.
    /// </summary>
    /// <param name="refreshToken">The refresh token.</param>
    /// <returns>The token response.</returns>
    private async Task<SpotifyTokenResponse?> RefreshAsync(string refreshToken)
    {
        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://accounts.spotify.com/api/token");
        req.Content = new FormUrlEncodedContent(new Dictionary<string, string?>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
            ["client_id"] = _clientId,
        }!);

        AddClientAuthHeaderIfPresent(req);

        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) return null;
        return JsonSerializer.Deserialize<SpotifyTokenResponse>(body, JsonOpts);
    }

    // ============================================================================================
    /// <summary>
    /// Adds the client authentication header to the request if present.
    /// </summary>
    /// <param name="req">The request.</param>
    private void AddClientAuthHeaderIfPresent(HttpRequestMessage req)
    {
        // For PKCE public clients, secret is not required. If the user configured one, use it.
        if (string.IsNullOrWhiteSpace(_clientSecret) || string.IsNullOrWhiteSpace(_clientId)) return;
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_clientId}:{_clientSecret}"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
    }

    // ============================================================================================
    /// <summary>
    /// Writes a cookie to the response.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="name">The name of the cookie.</param>
    /// <param name="value">The value of the cookie.</param>
    /// <param name="ttl">The time to live for the cookie.</param>
    /// <param name="httpOnly">Whether the cookie is HTTP only.</param>
    private void WriteCookie(HttpContext ctx, string name, string value, TimeSpan ttl, bool httpOnly)
    {
        ctx.Response.Cookies.Append(name, value, new CookieOptions
        {
            HttpOnly = httpOnly,
            Secure = _requireSecureCookies,
            SameSite = SameSiteMode.Lax,
            IsEssential = true,
            Expires = DateTimeOffset.UtcNow.Add(ttl),
            Path = "/"
        });
    }

    // ============================================================================================
    /// <summary>
    /// Reads a cookie from the request.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="name">The name of the cookie.</param>
    /// <returns>The value of the cookie.</returns>
    private string? ReadCookie(HttpContext ctx, string name)
        => ctx.Request.Cookies.TryGetValue(name, out var v) ? v : null;

    // ============================================================================================
    /// <summary>
    /// Deletes a cookie from the response.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="name">The name of the cookie.</param>
    private void DeleteCookie(HttpContext ctx, string name)
    {
        ctx.Response.Cookies.Delete(name, new CookieOptions
        {
            Secure = _requireSecureCookies,
            SameSite = SameSiteMode.Lax,
            Path = "/"
        });
    }

    // ============================================================================================
    /// <summary>
    /// Compares two strings in a fixed time manner.
    /// </summary>
    /// <param name="a">The first string.</param>
    /// <param name="b">The second string.</param>
    /// <returns>True if the strings are equal, false otherwise.</returns>
    private static bool FixedTimeEquals(string a, string b)
    {
        var ab = Encoding.UTF8.GetBytes(a);
        var bb = Encoding.UTF8.GetBytes(b);
        return ab.Length == bb.Length && CryptographicOperations.FixedTimeEquals(ab, bb);
    }

    // ============================================================================================
    /// <summary>
    /// Resolves a value or file path.
    /// </summary>
    /// <param name="value">The value.</param>
    /// <param name="filePath">The file path.</param>
    /// <param name="keyName">The name of the key.</param>
    /// <returns>The resolved value or null if the value or file path is not present.</returns>
    private static string? ResolveValueOrFile(string? value, string? filePath, string keyName)
    {
        if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
        if (string.IsNullOrWhiteSpace(filePath)) return null;

        try
        {
            if (!File.Exists(filePath))
            {
                return null;
            }
            return File.ReadAllText(filePath).Trim();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Failed to read secret file for {keyName} at '{filePath}'.", ex);
        }
    }
}
