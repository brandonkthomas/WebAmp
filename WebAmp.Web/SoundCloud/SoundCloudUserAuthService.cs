using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace WebAmp.Web.SoundCloud;

/// <summary>
/// Handles SoundCloud user authentication via the Authorization Code flow
/// with PKCE, storing an encrypted auth ticket in an HttpOnly cookie.
/// </summary>
public sealed class SoundCloudUserAuthService
{
    private const string TicketCookieName = "wa_sc_ticket";
    private const string OAuthStateCookieName = "wa_sc_oauth_state";
    private const string PkceVerifierCookieName = "wa_sc_pkce_verifier";
    private const string ReturnUrlCookieName = "wa_sc_return";

    private readonly SoundCloudOptions _options;
    private readonly string? _clientId;
    private readonly string? _clientSecret;
    private readonly string? _redirectUri;
    private readonly bool _requireSecureCookies;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IDataProtector _protector;

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public SoundCloudUserAuthService(
        IOptions<SoundCloudOptions> options,
        IHttpClientFactory httpClientFactory,
        IDataProtectionProvider dataProtectionProvider)
    {
        _options = options.Value;
        _clientId = ResolveValueOrFile(_options.ClientId, _options.ClientIdFile, "SoundCloud:ClientId");
        _clientSecret = ResolveValueOrFile(_options.ClientSecret, _options.ClientSecretFile, "SoundCloud:ClientSecret");
        _redirectUri = string.IsNullOrWhiteSpace(_options.RedirectUri) ? null : _options.RedirectUri.Trim();
        _requireSecureCookies = _options.RequireSecureCookies;
        _httpClientFactory = httpClientFactory;
        _protector = dataProtectionProvider.CreateProtector("WebAmp.SoundCloud.UserAuthTicket.v1");
    }

    /// <summary>
    /// True when the minimum configuration for user auth is present.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_clientId) &&
        !string.IsNullOrWhiteSpace(_clientSecret) &&
        !string.IsNullOrWhiteSpace(_redirectUri);

    /// <summary>
    /// Builds the SoundCloud authorize URL and writes state/PKCE/returnUrl
    /// cookies used by the callback.
    /// </summary>
    public string GetAuthorizeUrl(HttpContext ctx, string returnUrl)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("SoundCloud user auth is not configured (missing ClientId/ClientSecret/RedirectUri).");
        }

        var state = SoundCloudPkce.CreateState();
        var verifier = SoundCloudPkce.CreateCodeVerifier();
        var challenge = SoundCloudPkce.CreateCodeChallenge(verifier);

        WriteCookie(ctx, OAuthStateCookieName, state, TimeSpan.FromMinutes(10), httpOnly: true);
        WriteCookie(ctx, PkceVerifierCookieName, verifier, TimeSpan.FromMinutes(10), httpOnly: true);
        WriteCookie(ctx, ReturnUrlCookieName, returnUrl, TimeSpan.FromMinutes(10), httpOnly: true);

        var q = new Dictionary<string, string?>
        {
            ["client_id"] = _clientId,
            ["redirect_uri"] = _redirectUri,
            ["response_type"] = "code",
            ["code_challenge_method"] = "S256",
            ["code_challenge"] = challenge,
            ["state"] = state
        };

        var query = string.Join("&", q.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value ?? "")}"));
        return $"https://secure.soundcloud.com/authorize?{query}";
    }

    /// <summary>
    /// Handles the callback from SoundCloud after the user approves or denies
    /// authorization.
    /// </summary>
    public async Task<(bool ok, string? error)> HandleCallbackAsync(
        HttpContext ctx,
        string? code,
        string? state,
        string? error)
    {
        if (!IsConfigured) return (false, "SoundCloud is not configured.");
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
        if (token is null || string.IsNullOrWhiteSpace(token.AccessToken) || string.IsNullOrWhiteSpace(token.RefreshToken))
        {
            return (false, "Token exchange failed.");
        }

        var ticket = new SoundCloudUserAuthTicket
        {
            AccessToken = token.AccessToken,
            RefreshToken = token.RefreshToken,
            ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(token.ExpiresIn),
            Scope = token.Scope
        };

        WriteTicket(ctx, ticket);

        // Clear one-time cookies.
        DeleteCookie(ctx, OAuthStateCookieName);
        DeleteCookie(ctx, PkceVerifierCookieName);

        return (true, null);
    }

    /// <summary>
    /// Consumes the return URL stored when the flow started.
    /// </summary>
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

    public SoundCloudUserAuthTicket? ReadTicket(HttpContext ctx)
    {
        var raw = ReadCookie(ctx, TicketCookieName);
        if (string.IsNullOrWhiteSpace(raw)) return null;

        try
        {
            var json = _protector.Unprotect(raw);
            return JsonSerializer.Deserialize<SoundCloudUserAuthTicket>(json, JsonOpts);
        }
        catch
        {
            return null;
        }
    }

    public void ClearTicket(HttpContext ctx) => DeleteCookie(ctx, TicketCookieName);

    /// <summary>
    /// Returns a valid access token, refreshing when needed.
    /// </summary>
    public async Task<string?> GetValidAccessTokenAsync(HttpContext ctx)
    {
        var ticket = ReadTicket(ctx);
        if (ticket is null) return null;

        if (!ticket.IsExpiredOrNearExpiry())
        {
            return ticket.AccessToken;
        }

        var refreshed = await RefreshAsync(ticket.RefreshToken);
        if (refreshed is null || string.IsNullOrWhiteSpace(refreshed.AccessToken))
        {
            return null;
        }

        ticket.AccessToken = refreshed.AccessToken;
        ticket.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(refreshed.ExpiresIn);
        ticket.Scope = refreshed.Scope ?? ticket.Scope;

        WriteTicket(ctx, ticket);
        return ticket.AccessToken;
    }

    private void WriteTicket(HttpContext ctx, SoundCloudUserAuthTicket ticket)
    {
        var json = JsonSerializer.Serialize(ticket, JsonOpts);
        var protectedValue = _protector.Protect(json);
        WriteCookie(ctx, TicketCookieName, protectedValue, TimeSpan.FromDays(30), httpOnly: true);
    }

    private async Task<SoundCloudUserTokenResponse?> ExchangeCodeAsync(string code, string codeVerifier)
    {
        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://secure.soundcloud.com/oauth/token");

        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");

        req.Content = new FormUrlEncodedContent(new Dictionary<string, string?>
        {
            ["grant_type"] = "authorization_code",
            ["client_id"] = _clientId,
            ["client_secret"] = _clientSecret,
            ["redirect_uri"] = _redirectUri,
            ["code_verifier"] = codeVerifier,
            ["code"] = code
        }!);

        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) return null;
        return JsonSerializer.Deserialize<SoundCloudUserTokenResponse>(body, JsonOpts);
    }

    private async Task<SoundCloudUserTokenResponse?> RefreshAsync(string refreshToken)
    {
        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://secure.soundcloud.com/oauth/token");

        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");

        req.Content = new FormUrlEncodedContent(new Dictionary<string, string?>
        {
            ["grant_type"] = "refresh_token",
            ["client_id"] = _clientId,
            ["client_secret"] = _clientSecret,
            ["refresh_token"] = refreshToken
        }!);

        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) return null;
        return JsonSerializer.Deserialize<SoundCloudUserTokenResponse>(body, JsonOpts);
    }

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

    private string? ReadCookie(HttpContext ctx, string name)
        => ctx.Request.Cookies.TryGetValue(name, out var v) ? v : null;

    private void DeleteCookie(HttpContext ctx, string name)
    {
        ctx.Response.Cookies.Delete(name, new CookieOptions
        {
            Secure = _requireSecureCookies,
            SameSite = SameSiteMode.Lax,
            Path = "/"
        });
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var ab = Encoding.UTF8.GetBytes(a);
        var bb = Encoding.UTF8.GetBytes(b);
        return ab.Length == bb.Length && CryptographicOperations.FixedTimeEquals(ab, bb);
    }

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
