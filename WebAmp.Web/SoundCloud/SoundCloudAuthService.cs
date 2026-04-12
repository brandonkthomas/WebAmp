using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace WebAmp.Web.SoundCloud;

// ============================================================================================
/// <summary>
/// Handles app-level authentication against the SoundCloud API using the
/// OAuth 2.1 client credentials flow.
/// </summary>
public sealed class SoundCloudAuthService
{
    private const string TokenEndpoint = "https://secure.soundcloud.com/oauth/token";
    private const string CacheKey = "WebAmp.SoundCloud.AppToken.v1";

    private readonly SoundCloudOptions _options;
    private readonly string? _clientId;
    private readonly string? _clientSecret;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    // ============================================================================================
    /// <summary>
    /// Creates a new <see cref="SoundCloudAuthService"/>.
    /// </summary>
    public SoundCloudAuthService(
        IOptions<SoundCloudOptions> options,
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache)
    {
        _options = options.Value;
        _clientId = ResolveValueOrFile(_options.ClientId, _options.ClientIdFile, "SoundCloud:ClientId");
        _clientSecret = ResolveValueOrFile(_options.ClientSecret, _options.ClientSecretFile, "SoundCloud:ClientSecret");
        _httpClientFactory = httpClientFactory;
        _cache = cache;
    }

    /// <summary>
    /// True when the minimum configuration for SoundCloud is present.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_clientId) &&
        !string.IsNullOrWhiteSpace(_clientSecret);

    private sealed class TokenResponse
    {
        public string? AccessToken { get; set; }
        public int ExpiresIn { get; set; }
        public string? RefreshToken { get; set; }
        public string? Scope { get; set; }
    }

    private sealed class TokenCacheEntry
    {
        public required string AccessToken { get; init; }
        public required DateTimeOffset ExpiresAt { get; init; }
    }

    /// <summary>
    /// Returns a cached or freshly-acquired app access token suitable for
    /// calling SoundCloud APIs that rely on the client credentials flow.
    /// </summary>
    public async Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        if (!IsConfigured) return null;

        // Renew a bit early to avoid edge-of-expiry races.
        if (_cache.TryGetValue<TokenCacheEntry>(CacheKey, out var cached) 
            && cached is not null
            && cached.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(1))
        {
            return cached.AccessToken;
        }

        var token = await RequestClientCredentialsTokenAsync(cancellationToken);
        if (token?.AccessToken is null || token.ExpiresIn <= 0)
        {
            return null;
        }

        // Store with a small safety margin.
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(60, token.ExpiresIn - 60));
        var entry = new TokenCacheEntry
        {
            AccessToken = token.AccessToken,
            ExpiresAt = expiresAt
        };

        _cache.Set(CacheKey, entry, expiresAt);
        return entry.AccessToken;
    }

    private async Task<TokenResponse?> RequestClientCredentialsTokenAsync(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_clientId) || string.IsNullOrWhiteSpace(_clientSecret))
        {
            return null;
        }

        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, TokenEndpoint);

        // Per SoundCloud docs, client credentials must be sent via HTTP Basic auth.
        // https://developers.soundcloud.com/docs/api/guide
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_clientId}:{_clientSecret}"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");

        req.Content = new FormUrlEncodedContent(new Dictionary<string, string?>
        {
            ["grant_type"] = "client_credentials"
        }!);

        using var resp = await client.SendAsync(req, cancellationToken);
        var body = await resp.Content.ReadAsStringAsync(cancellationToken);
        if (!resp.IsSuccessStatusCode) return null;

        try
        {
            return JsonSerializer.Deserialize<TokenResponse>(body, JsonOpts);
        }
        catch (JsonException)
        {
            return null;
        }
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
