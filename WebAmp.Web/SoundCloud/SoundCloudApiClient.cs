using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace WebAmp.Web.SoundCloud;

// ============================================================================================
/// <summary>
/// Thin HTTP client wrapper for the SoundCloud REST API.
/// </summary>
public sealed class SoundCloudApiClient
{
    private static readonly Uri BaseUri = new("https://api.soundcloud.com/");
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SoundCloudAuthService _auth;

    public SoundCloudApiClient(IHttpClientFactory httpClientFactory, SoundCloudAuthService auth)
    {
        _httpClientFactory = httpClientFactory;
        _auth = auth;
    }

    // ============================================================================================
    /// <summary>
    /// Issues an authenticated GET and returns lightweight metadata about the response.
    /// This avoids reading large non-JSON payload bodies (e.g. redirected audio streams).
    /// </summary>
    public async Task<(HttpStatusCode status, JsonDocument? json, Uri? finalUri, string? mediaType)> GetMetaAsync(
        string pathOrUrl,
        CancellationToken cancellationToken = default)
    {
        var token = await _auth.GetAccessTokenAsync(cancellationToken);
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
                json = TryParseJson(body);
            }
        }

        return (resp.StatusCode, json, resp.RequestMessage?.RequestUri, mediaType);
    }

    // ============================================================================================
    /// <summary>
    /// Issues an authenticated GET request to SoundCloud.
    /// </summary>
    /// <param name="pathOrUrl">
    /// Either a relative path/query (e.g. "tracks?q=...") or a full absolute URL
    /// such as the <c>stream_url</c> returned by the API.
    /// </param>
    public async Task<(HttpStatusCode status, JsonDocument? json)> GetAsync(
        string pathOrUrl,
        CancellationToken cancellationToken = default)
    {
        var token = await _auth.GetAccessTokenAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null);

        var client = _httpClientFactory.CreateClient();

        var uri = BuildUri(pathOrUrl);

        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        // SoundCloud examples use both "Bearer" and "OAuth" schemes; "Bearer" is
        // aligned with modern OAuth 2.1 usage.
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");

        using var resp = await client.SendAsync(req, cancellationToken);
        var body = await resp.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(body)) return (resp.StatusCode, null);

        return (resp.StatusCode, TryParseJson(body));
    }

    private static Uri BuildUri(string pathOrUrl)
    {
        if (Uri.TryCreate(pathOrUrl, UriKind.Absolute, out var absolute))
        {
            return absolute;
        }

        var trimmed = pathOrUrl.TrimStart('/');
        return new Uri(BaseUri, trimmed);
    }

    private static JsonDocument? TryParseJson(string body)
    {
        try
        {
            return JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
