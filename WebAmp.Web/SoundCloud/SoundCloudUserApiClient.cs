using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace WebAmp.Web.SoundCloud;

/// <summary>
/// Client for user-scoped SoundCloud API calls (Authorization Code flow).
/// </summary>
public sealed class SoundCloudUserApiClient
{
    private static readonly Uri BaseUri = new("https://api.soundcloud.com/");
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SoundCloudUserAuthService _auth;

    public SoundCloudUserApiClient(IHttpClientFactory httpClientFactory, SoundCloudUserAuthService auth)
    {
        _httpClientFactory = httpClientFactory;
        _auth = auth;
    }

    public async Task<(HttpStatusCode status, JsonDocument? json)> GetAsync(HttpContext ctx, string pathAndQuery)
    {
        var token = await _auth.GetValidAccessTokenAsync(ctx);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null);

        var client = _httpClientFactory.CreateClient();
        var uri = BuildUri(pathAndQuery);

        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");

        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return (resp.StatusCode, null);

        try
        {
            return (resp.StatusCode, JsonDocument.Parse(body));
        }
        catch (JsonException)
        {
            return (resp.StatusCode, null);
        }
    }

    public async Task<(HttpStatusCode status, JsonDocument? json)> PostJsonAsync(
        HttpContext ctx,
        string pathAndQuery,
        object? payload = null)
    {
        var token = await _auth.GetValidAccessTokenAsync(ctx);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null);

        var client = _httpClientFactory.CreateClient();
        var uri = BuildUri(pathAndQuery);

        using var req = new HttpRequestMessage(HttpMethod.Post, uri);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");
        if (payload is not null)
        {
            var json = JsonSerializer.Serialize(payload, JsonOpts);
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return (resp.StatusCode, null);

        try
        {
            return (resp.StatusCode, JsonDocument.Parse(body));
        }
        catch (JsonException)
        {
            return (resp.StatusCode, null);
        }
    }

    public async Task<(HttpStatusCode status, JsonDocument? json)> DeleteAsync(
        HttpContext ctx,
        string pathAndQuery)
    {
        var token = await _auth.GetValidAccessTokenAsync(ctx);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null);

        var client = _httpClientFactory.CreateClient();
        var uri = BuildUri(pathAndQuery);

        using var req = new HttpRequestMessage(HttpMethod.Delete, uri);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");

        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return (resp.StatusCode, null);

        try
        {
            return (resp.StatusCode, JsonDocument.Parse(body));
        }
        catch (JsonException)
        {
            return (resp.StatusCode, null);
        }
    }

    public async Task<(HttpStatusCode status, JsonDocument? json, Uri? finalUri, string? mediaType)> GetMetaAsync(
        HttpContext ctx,
        string pathOrUrl,
        CancellationToken cancellationToken = default)
    {
        var token = await _auth.GetValidAccessTokenAsync(ctx);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null, null, null);

        var client = _httpClientFactory.CreateClient();
        var uri = BuildUri(pathOrUrl);

        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");

        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        var mediaType = resp.Content.Headers.ContentType?.MediaType;
        JsonDocument? json = null;
        if (!string.IsNullOrWhiteSpace(mediaType) &&
            mediaType.Contains("json", StringComparison.OrdinalIgnoreCase))
        {
            var body = await resp.Content.ReadAsStringAsync(cancellationToken);
            if (!string.IsNullOrWhiteSpace(body))
            {
                try { json = JsonDocument.Parse(body); }
                catch (JsonException) { json = null; }
            }
        }

        return (resp.StatusCode, json, resp.RequestMessage?.RequestUri, mediaType);
    }

    private static Uri BuildUri(string pathOrUrl)
    {
        if (Uri.TryCreate(pathOrUrl, UriKind.Absolute, out var absolute))
        {
            if (!IsAllowedApiUri(absolute))
            {
                throw new InvalidOperationException("SoundCloud API URLs must use https://api.soundcloud.com.");
            }
            return absolute;
        }

        var trimmed = pathOrUrl.TrimStart('/');
        var resolved = new Uri(BaseUri, trimmed);
        if (!IsAllowedApiUri(resolved))
        {
            throw new InvalidOperationException("SoundCloud API URLs must use https://api.soundcloud.com.");
        }

        return resolved;
    }

    public static bool IsAllowedApiUrl(string value)
        => Uri.TryCreate(value, UriKind.Absolute, out var uri) && IsAllowedApiUri(uri);

    private static bool IsAllowedApiUri(Uri uri)
        => string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.Host, BaseUri.Host, StringComparison.OrdinalIgnoreCase)
            && (uri.IsDefaultPort || uri.Port == 443);
}
